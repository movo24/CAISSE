import { Test } from '@nestjs/testing';
import { CouponService } from './coupon.service';
import { getRepositoryToken } from '@nestjs/typeorm';
import { CouponEntity } from '../../database/entities/coupon.entity';
import { CustomerVisitEntity } from '../../database/entities/customer-visit.entity';
import { LoyaltyRewardCycleEntity } from '../../database/entities/loyalty-reward-cycle.entity';
import { IdempotencyKeyEntity } from '../../database/entities/idempotency-key.entity';
import { CustomerEntity } from '../../database/entities/customer.entity';
import { DataSource } from 'typeorm';
import { AuditService } from '../audit/audit.service';

/**
 * Unit tests for CouponService — focus on the critical logic
 * (no DB integration here; the redeem transaction is tested in e2e).
 */
describe('CouponService', () => {
  let service: CouponService;
  let couponRepo: any;
  let cycleRepo: any;

  const makeCoupon = (overrides: Partial<CouponEntity> = {}): CouponEntity =>
    ({
      id: 'cp1',
      customerId: 'c1',
      type: 'WELCOME',
      discountType: 'PERCENT',
      discountValue: 5,
      status: 'AVAILABLE',
      validFrom: new Date(),
      validUntil: null,
      createdAt: new Date(),
      ...overrides,
    }) as CouponEntity;

  beforeEach(async () => {
    couponRepo = {
      findOne: jest.fn(),
      find: jest.fn(),
      count: jest.fn(),
      save: jest.fn((x) => Promise.resolve(x)),
      create: jest.fn((x) => x),
      createQueryBuilder: jest.fn(() => {
        const qb: any = {
          where: jest.fn().mockReturnThis(),
          andWhere: jest.fn().mockReturnThis(),
          orderBy: jest.fn().mockReturnThis(),
          getOne: jest.fn(),
          getMany: jest.fn().mockResolvedValue([]),
        };
        return qb;
      }),
    };
    cycleRepo = {
      find: jest.fn().mockResolvedValue([
        { rank: 1, discountPercent: 5 },
        { rank: 2, discountPercent: 5 },
        { rank: 3, discountPercent: 10 },
        { rank: 4, discountPercent: 5 },
      ]),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        CouponService,
        { provide: getRepositoryToken(CouponEntity), useValue: couponRepo },
        {
          provide: getRepositoryToken(CustomerVisitEntity),
          useValue: { find: jest.fn() },
        },
        {
          provide: getRepositoryToken(LoyaltyRewardCycleEntity),
          useValue: cycleRepo,
        },
        {
          provide: getRepositoryToken(IdempotencyKeyEntity),
          useValue: { findOne: jest.fn() },
        },
        {
          provide: getRepositoryToken(CustomerEntity),
          useValue: { findOne: jest.fn() },
        },
        { provide: DataSource, useValue: { transaction: jest.fn() } },
        { provide: AuditService, useValue: { log: jest.fn() } },
      ],
    }).compile();

    service = moduleRef.get(CouponService);
  });

  describe('issueWelcome', () => {
    it('creates an AVAILABLE WELCOME coupon at 5%', async () => {
      const result = await service.issueWelcome('c1');
      expect(result.type).toBe('WELCOME');
      expect(result.discountValue).toBe(5);
      expect(result.status).toBe('AVAILABLE');
      expect(couponRepo.save).toHaveBeenCalled();
    });
  });

  describe('calculateNextReward', () => {
    it('returns eligible when no coupon was ever used', async () => {
      const qb: any = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue(null),
      };
      couponRepo.createQueryBuilder.mockReturnValue(qb);

      const result = await service.calculateNextReward('c1');
      expect(result.eligible).toBe(true);
      expect(result.discountPercent).toBe(5);
    });

    it('rejects within 14 days of last use (cooldown 15j)', async () => {
      const used = makeCoupon({
        status: 'USED',
        usedAt: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000),
      });
      const qb: any = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue(used),
      };
      couponRepo.createQueryBuilder.mockReturnValue(qb);

      const result = await service.calculateNextReward('c1');
      expect(result.eligible).toBe(false);
      expect(result.daysRemaining).toBe(1);
    });

    it('eligible at exactly 15 days', async () => {
      const used = makeCoupon({
        status: 'USED',
        usedAt: new Date(Date.now() - 15 * 24 * 60 * 60 * 1000 - 1000),
      });
      const qb: any = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue(used),
      };
      couponRepo.createQueryBuilder.mockReturnValue(qb);
      couponRepo.count.mockResolvedValue(1);

      const result = await service.calculateNextReward('c1');
      expect(result.eligible).toBe(true);
    });

    it('respects cycle rank 5/5/10/5 (3rd reward = 10%)', async () => {
      const used = makeCoupon({
        status: 'USED',
        usedAt: new Date(Date.now() - 16 * 24 * 60 * 60 * 1000),
      });
      const qb: any = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue(used),
      };
      couponRepo.createQueryBuilder.mockReturnValue(qb);
      // 2 used coupons → next rank = 3 → 10%
      couponRepo.count.mockResolvedValue(2);

      const result = await service.calculateNextReward('c1');
      expect(result.eligible).toBe(true);
      expect(result.discountPercent).toBe(10);
    });

    it('cycle wraps around (5th reward = rank 1 = 5%)', async () => {
      const used = makeCoupon({
        status: 'USED',
        usedAt: new Date(Date.now() - 16 * 24 * 60 * 60 * 1000),
      });
      const qb: any = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue(used),
      };
      couponRepo.createQueryBuilder.mockReturnValue(qb);
      couponRepo.count.mockResolvedValue(4); // 4 used → next = rank 5 → wraps to rank 1 = 5%

      const result = await service.calculateNextReward('c1');
      expect(result.discountPercent).toBe(5);
    });
  });
});

describe('CouponService.redeem — D16 phantom-audit fix', () => {
  let service: CouponService;
  let audit: { log: jest.Mock };
  let mgr: any;

  const couponRow = () => ({ id: 'cp1', customer_id: 'c1', status: 'AVAILABLE', valid_until: null, discount_value: 5 });
  const payload: any = { customerId: 'c1', couponId: 'cp1', storeId: 's1', ticketId: 't1', ticketAmountCents: 1000, cashierEmployeeId: 'e1' };

  const build = async () => {
    mgr = {
      findOne: jest.fn().mockResolvedValue(null), // idempotency cache: none (real redemption)
      query: jest.fn().mockImplementation((sql: string) =>
        /SELECT \* FROM coupons/i.test(sql) ? Promise.resolve([couponRow()]) : Promise.resolve([]),
      ),
      createQueryBuilder: jest.fn(() => ({
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue(null), // no prior USED coupon → no cooldown
      })),
      update: jest.fn().mockResolvedValue({}),
      insert: jest.fn().mockResolvedValue({}),
    };
    audit = { log: jest.fn().mockResolvedValue(undefined) };
    const moduleRef = await Test.createTestingModule({
      providers: [
        CouponService,
        { provide: getRepositoryToken(CouponEntity), useValue: {} },
        { provide: getRepositoryToken(CustomerVisitEntity), useValue: {} },
        { provide: getRepositoryToken(LoyaltyRewardCycleEntity), useValue: {} },
        { provide: getRepositoryToken(IdempotencyKeyEntity), useValue: {} },
        { provide: getRepositoryToken(CustomerEntity), useValue: {} },
        { provide: DataSource, useValue: { transaction: (fn: any) => fn(mgr) } },
        { provide: AuditService, useValue: audit },
      ],
    }).compile();
    service = moduleRef.get(CouponService);
  };

  it('PHANTOM-FIX — audit is post-commit best-effort: an audit failure does NOT roll back the redemption', async () => {
    await build();
    audit.log.mockRejectedValueOnce(new Error('audit down'));
    const res = await service.redeem(payload, 'idem-key-123456');
    expect(res.success).toBe(true);             // committed despite the audit failure
    expect(mgr.update).toHaveBeenCalled();      // coupon was marked USED
    expect(audit.log).toHaveBeenCalledTimes(1); // attempted once, AFTER commit
  });

  it('a cache REPLAY returns the cached response and does NOT re-audit (no phantom)', async () => {
    await build();
    mgr.findOne.mockResolvedValue({ responseBody: { success: true, discountPercent: 5, couponId: 'cp1' } });
    const res = await service.redeem(payload, 'idem-key-123456');
    expect(res.success).toBe(true);
    expect(audit.log).not.toHaveBeenCalled();   // replay path captures no audit payload
  });
});
