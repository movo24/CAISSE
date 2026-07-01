import { DataSource, Repository } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';

import { createPgMemDataSource } from '../../../test/helpers/pgmem';
import { CouponService, RedeemPayload } from './coupon.service';
import { CouponEntity } from '../../database/entities/coupon.entity';
import { CustomerVisitEntity } from '../../database/entities/customer-visit.entity';
import { LoyaltyRewardCycleEntity } from '../../database/entities/loyalty-reward-cycle.entity';
import { IdempotencyKeyEntity } from '../../database/entities/idempotency-key.entity';
import { CustomerEntity } from '../../database/entities/customer.entity';
import { StoreEntity } from '../../database/entities/store.entity';

// PAQUET 279 — CouponService.redeem against a real in-memory Postgres (pg-mem):
// the money-critical redemption transaction proven on real SQL — FOR UPDATE
// lock read, idempotency replay (same key → cached response, no double USED),
// ownership/status/expiry/cooldown refusals, and the side-effects
// (visit inserted with couponUsedId, lockedByIdempotencyKey persisted).
// Policy helpers have their own pure suite (coupon-policy).

const IDEM = () => `idem-${uuidv4()}`;

describe('CouponService.redeem (pg-mem)', () => {
  let dataSource: DataSource;
  let couponRepo: Repository<CouponEntity>;
  let visitRepo: Repository<CustomerVisitEntity>;
  let idemRepo: Repository<IdempotencyKeyEntity>;
  let customerRepo: Repository<CustomerEntity>;
  let service: CouponService;
  const auditLog = jest.fn().mockResolvedValue(undefined);

  let storeId: string;
  let customerId: string;
  let strangerId: string;

  const mkCoupon = (over: Partial<CouponEntity> = {}) =>
    couponRepo.save(
      couponRepo.create({
        customerId,
        type: 'WELCOME',
        discountValue: 5,
        status: 'AVAILABLE',
        validFrom: new Date(Date.now() - 86_400_000),
        validUntil: new Date(Date.now() + 30 * 86_400_000),
        ...over,
      } as Partial<CouponEntity>),
    );

  const payload = (couponId: string, over: Partial<RedeemPayload> = {}): RedeemPayload => ({
    customerId,
    couponId,
    storeId,
    ticketId: uuidv4(),
    ticketAmountCents: 1000,
    ...over,
  });

  beforeAll(async () => {
    const built = createPgMemDataSource();
    dataSource = built.dataSource;
    await dataSource.initialize();
    couponRepo = dataSource.getRepository(CouponEntity);
    visitRepo = dataSource.getRepository(CustomerVisitEntity);
    idemRepo = dataSource.getRepository(IdempotencyKeyEntity);
    customerRepo = dataSource.getRepository(CustomerEntity);
    service = new CouponService(
      couponRepo,
      visitRepo,
      dataSource.getRepository(LoyaltyRewardCycleEntity),
      idemRepo,
      customerRepo,
      dataSource,
      { log: auditLog } as any, // audit hash-chain has its own suites
    );

    const storeRepo = dataSource.getRepository(StoreEntity);
    storeId = (await storeRepo.save(storeRepo.create({ name: 'Wesley' }))).id;
    customerId = (
      await customerRepo.save(
        customerRepo.create({ firstName: 'Ada', lastName: 'L', qrCode: 'QR-1', storeId } as Partial<CustomerEntity>),
      )
    ).id;
    strangerId = (
      await customerRepo.save(
        customerRepo.create({ firstName: 'Eve', lastName: 'X', qrCode: 'QR-2', storeId } as Partial<CustomerEntity>),
      )
    ).id;
  });

  beforeEach(() => auditLog.mockClear());

  afterAll(async () => {
    if (dataSource?.isInitialized) await dataSource.destroy();
  });

  it('happy path: marks USED with lockedByIdempotencyKey, inserts the visit, caches the idempotency response, audits', async () => {
    const coupon = await mkCoupon();
    const key = IDEM();
    const res = await service.redeem(payload(coupon.id), key);
    expect(res).toEqual({ success: true, discountPercent: 5, couponId: coupon.id });

    const row = (await couponRepo.findOneBy({ id: coupon.id }))!;
    expect(row.status).toBe('USED');
    expect(row.lockedByIdempotencyKey).toBe(key);
    expect(await visitRepo.countBy({ couponUsedId: coupon.id } as any)).toBe(1);
    expect(await idemRepo.countBy({ key })).toBe(1);
    expect(auditLog).toHaveBeenCalledTimes(1);
  });

  it('idempotent replay: SAME key returns the cached response and creates no second visit', async () => {
    const coupon = await couponRepo.findOneBy({ customerId, status: 'USED' } as any);
    const key = (coupon as CouponEntity).lockedByIdempotencyKey!;
    const visitsBefore = await visitRepo.count();

    const replay = await service.redeem(payload(coupon!.id), key);
    expect(replay).toEqual({ success: true, discountPercent: 5, couponId: coupon!.id });
    expect(await visitRepo.count()).toBe(visitsBefore); // no new side-effect
    expect(auditLog).not.toHaveBeenCalled(); // short-circuited before step 7
  });

  it('a NEW key on an already-USED coupon is refused (409) — no double redemption', async () => {
    const used = await couponRepo.findOneBy({ customerId, status: 'USED' } as any);
    await expect(service.redeem(payload(used!.id), IDEM())).rejects.toThrow(ConflictException);
  });

  it('refusals: bad key (400), unknown coupon (404), wrong owner (403), expired (409)', async () => {
    const coupon = await mkCoupon({ customerId: strangerId });
    await expect(service.redeem(payload(coupon.id), 'short')).rejects.toThrow(BadRequestException);
    await expect(service.redeem(payload(uuidv4()), IDEM())).rejects.toThrow(NotFoundException);
    await expect(service.redeem(payload(coupon.id), IDEM())).rejects.toThrow(ForbiddenException); // owned by stranger

    const expired = await mkCoupon({
      customerId: strangerId,
      validUntil: new Date(Date.now() - 86_400_000),
    });
    await expect(
      service.redeem(payload(expired.id, { customerId: strangerId }), IDEM()),
    ).rejects.toThrow(ConflictException);
  });

  it('cooldown 15 jours: a second AVAILABLE coupon right after a USED one is refused (409, real ORDER BY usedAt query)', async () => {
    const second = await mkCoupon(); // customer already has a USED coupon from the happy path
    await expect(service.redeem(payload(second.id), IDEM())).rejects.toThrow(ConflictException);
    // and the coupon was NOT consumed by the failed attempt (transaction rolled back)
    expect((await couponRepo.findOneBy({ id: second.id }))!.status).toBe('AVAILABLE');
  });
});
