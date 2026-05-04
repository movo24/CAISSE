import {
  Injectable,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource, IsNull } from 'typeorm';
import { CouponEntity } from '../../database/entities/coupon.entity';
import { CustomerVisitEntity } from '../../database/entities/customer-visit.entity';
import { LoyaltyRewardCycleEntity } from '../../database/entities/loyalty-reward-cycle.entity';
import { IdempotencyKeyEntity } from '../../database/entities/idempotency-key.entity';
import { CustomerEntity } from '../../database/entities/customer.entity';
import { AuditService } from '../audit/audit.service';

const COOLDOWN_DAYS = 15;
const WELCOME_DISCOUNT = 5;
const COUPON_VALIDITY_DAYS = 30;

export interface NextRewardInfo {
  eligible: boolean;
  discountPercent?: number;
  daysRemaining?: number;
  nextAvailableAt?: string;
  reason?: string;
}

export interface RedeemPayload {
  customerId: string;
  couponId: string;
  storeId: string;
  terminalId?: string;
  ticketId: string;
  ticketAmountCents: number;
  cashierEmployeeId?: string;
}

@Injectable()
export class CouponService {
  constructor(
    @InjectRepository(CouponEntity)
    private readonly couponRepo: Repository<CouponEntity>,
    @InjectRepository(CustomerVisitEntity)
    private readonly visitRepo: Repository<CustomerVisitEntity>,
    @InjectRepository(LoyaltyRewardCycleEntity)
    private readonly cycleRepo: Repository<LoyaltyRewardCycleEntity>,
    @InjectRepository(IdempotencyKeyEntity)
    private readonly idempotencyRepo: Repository<IdempotencyKeyEntity>,
    @InjectRepository(CustomerEntity)
    private readonly customerRepo: Repository<CustomerEntity>,
    private readonly dataSource: DataSource,
    private readonly auditService: AuditService,
  ) {}

  // ────────────────────────────────────────────────────────────────
  // EMISSION
  // ────────────────────────────────────────────────────────────────

  /** Issue welcome coupon at registration. */
  async issueWelcome(customerId: string): Promise<CouponEntity> {
    const validUntil = new Date();
    validUntil.setDate(validUntil.getDate() + COUPON_VALIDITY_DAYS);

    const coupon = this.couponRepo.create({
      customerId,
      type: 'WELCOME',
      discountType: 'PERCENT',
      discountValue: WELCOME_DISCOUNT,
      status: 'AVAILABLE',
      validFrom: new Date(),
      validUntil,
    });
    return this.couponRepo.save(coupon);
  }

  // ────────────────────────────────────────────────────────────────
  // QUERIES
  // ────────────────────────────────────────────────────────────────

  /** Find the active (AVAILABLE, not expired) coupon for a customer, if any. */
  async findActiveCoupon(customerId: string): Promise<CouponEntity | null> {
    const now = new Date();
    return this.couponRepo
      .createQueryBuilder('c')
      .where('c.customerId = :customerId', { customerId })
      .andWhere('c.status = :status', { status: 'AVAILABLE' })
      .andWhere('(c.validUntil IS NULL OR c.validUntil > :now)', { now })
      .orderBy('c.createdAt', 'ASC')
      .getOne();
  }

  /** List coupons for a customer (history). */
  async listForCustomer(
    customerId: string,
    statusFilter?: 'AVAILABLE' | 'USED' | 'ALL',
  ): Promise<CouponEntity[]> {
    const qb = this.couponRepo
      .createQueryBuilder('c')
      .where('c.customerId = :customerId', { customerId });

    if (statusFilter === 'AVAILABLE') {
      qb.andWhere('c.status = :s', { s: 'AVAILABLE' });
    } else if (statusFilter === 'USED') {
      qb.andWhere('c.status = :s', { s: 'USED' });
    }

    return qb.orderBy('c.createdAt', 'DESC').getMany();
  }

  // ────────────────────────────────────────────────────────────────
  // NEXT REWARD CALCULATION (cycle 5/5/10/5)
  // ────────────────────────────────────────────────────────────────

  /**
   * Compute eligibility for next loyalty reward.
   * Cooldown: 15 days since last USED coupon (any type).
   */
  async calculateNextReward(customerId: string): Promise<NextRewardInfo> {
    const lastUsed = await this.couponRepo
      .createQueryBuilder('c')
      .where('c.customerId = :customerId', { customerId })
      .andWhere('c.status = :status', { status: 'USED' })
      .orderBy('c.usedAt', 'DESC')
      .getOne();

    // No used coupon yet → eligible immediately for rank 1
    if (!lastUsed || !lastUsed.usedAt) {
      const cycle = await this.getCycleForRank(1);
      return {
        eligible: true,
        discountPercent: cycle?.discountPercent ?? 5,
      };
    }

    const cooldownEnd = new Date(lastUsed.usedAt);
    cooldownEnd.setDate(cooldownEnd.getDate() + COOLDOWN_DAYS);

    if (cooldownEnd > new Date()) {
      const msRemaining = cooldownEnd.getTime() - Date.now();
      const daysRemaining = Math.ceil(msRemaining / (1000 * 60 * 60 * 24));
      return {
        eligible: false,
        daysRemaining,
        nextAvailableAt: cooldownEnd.toISOString(),
        reason: `Prochain avantage disponible dans ${daysRemaining} jour${daysRemaining > 1 ? 's' : ''}.`,
      };
    }

    // Eligible. Determine rank.
    const usedCount = await this.couponRepo.count({
      where: { customerId, status: 'USED' },
    });
    const cycle = await this.getCycleForRank(usedCount + 1);
    return {
      eligible: true,
      discountPercent: cycle?.discountPercent ?? 5,
    };
  }

  private async getCycleForRank(
    rank: number,
  ): Promise<LoyaltyRewardCycleEntity | null> {
    // Default: pick global cycle (storeId IS NULL) modulo cycle length
    const cycles = await this.cycleRepo.find({
      where: { storeId: IsNull(), active: true },
      order: { rank: 'ASC' },
    });
    if (cycles.length === 0) return null;
    const idx = ((rank - 1) % cycles.length + cycles.length) % cycles.length;
    return cycles[idx];
  }

  // ────────────────────────────────────────────────────────────────
  // SCAN — POS lookup (no state change)
  // ────────────────────────────────────────────────────────────────

  /**
   * Resolve customer info + available coupon for POS display.
   * Read-only. Does NOT lock anything.
   */
  async scanForPos(customerId: string) {
    const customer = await this.customerRepo.findOne({
      where: { id: customerId },
    });
    if (!customer || customer.deletedAt) {
      throw new NotFoundException('Client introuvable');
    }

    const activeCoupon = await this.findActiveCoupon(customerId);
    const nextReward = await this.calculateNextReward(customerId);

    return {
      customerFound: true,
      customerId: customer.id,
      firstName: customer.firstName,
      availableCoupon: activeCoupon
        ? {
            id: activeCoupon.id,
            type: activeCoupon.type,
            discountPercent: activeCoupon.discountValue,
          }
        : null,
      nextReward,
      message: activeCoupon
        ? `Client reconnu — avantage disponible : -${activeCoupon.discountValue}%`
        : nextReward.eligible
          ? 'Client reconnu — avantage à émettre'
          : `Client reconnu — ${nextReward.reason}`,
    };
  }

  // ────────────────────────────────────────────────────────────────
  // REDEEM — TRANSACTIONAL CRITICAL PATH
  // ────────────────────────────────────────────────────────────────

  /**
   * Redeem a coupon. Strictly transactional with row-level lock.
   * Idempotent via X-Idempotency-Key header.
   *
   * Steps inside transaction:
   *   1. Check idempotency cache (return cached response if exists)
   *   2. SELECT coupon FOR UPDATE
   *   3. Verify status, ownership, expiry, cooldown
   *   4. UPDATE coupon → USED + lock idempotency key
   *   5. INSERT customer_visit
   *   6. UPDATE customers.visit_count, last_visit_at
   *   7. AuditService.log
   *   8. Cache idempotency response
   */
  async redeem(
    payload: RedeemPayload,
    idempotencyKey: string,
  ): Promise<{ success: true; discountPercent: number; couponId: string }> {
    if (!idempotencyKey || idempotencyKey.length < 10) {
      throw new BadRequestException('Idempotency-Key requis');
    }

    return this.dataSource.transaction(async (mgr) => {
      // 1. Idempotency cache check
      const cached = await mgr.findOne(IdempotencyKeyEntity, {
        where: { key: idempotencyKey },
      });
      if (cached) {
        return cached.responseBody as any;
      }

      // 2. Lock coupon
      const coupons = await mgr.query(
        `SELECT * FROM coupons WHERE id = $1 FOR UPDATE`,
        [payload.couponId],
      );
      if (coupons.length === 0) {
        throw new NotFoundException('Coupon introuvable');
      }
      const coupon = coupons[0];

      // 3. Verifications
      if (coupon.customer_id !== payload.customerId) {
        throw new ForbiddenException('Coupon ne correspond pas au client');
      }
      if (coupon.status !== 'AVAILABLE') {
        throw new ConflictException(
          `Coupon non disponible (${coupon.status.toLowerCase()})`,
        );
      }
      if (
        coupon.valid_until &&
        new Date(coupon.valid_until).getTime() < Date.now()
      ) {
        throw new ConflictException('Coupon expiré');
      }

      // 3b. Cooldown 15 jours (check on customer's last USED coupon)
      const lastUsed = await mgr
        .createQueryBuilder(CouponEntity, 'c')
        .where('c.customerId = :customerId', {
          customerId: payload.customerId,
        })
        .andWhere('c.status = :status', { status: 'USED' })
        .orderBy('c.usedAt', 'DESC')
        .getOne();

      if (lastUsed?.usedAt) {
        const cooldownEnd = new Date(lastUsed.usedAt);
        cooldownEnd.setDate(cooldownEnd.getDate() + COOLDOWN_DAYS);
        if (cooldownEnd > new Date()) {
          throw new ConflictException(
            `Cooldown 15 jours non respecté (prochain avantage : ${cooldownEnd.toISOString()})`,
          );
        }
      }

      // 4. Mark USED
      await mgr.update(CouponEntity, coupon.id, {
        status: 'USED',
        usedAt: new Date(),
        usedTicketId: payload.ticketId,
        usedStoreId: payload.storeId,
        usedTerminalId: payload.terminalId ?? null,
        lockedByIdempotencyKey: idempotencyKey,
      });

      // 5. Insert visit
      await mgr.insert(CustomerVisitEntity, {
        customerId: payload.customerId,
        storeId: payload.storeId,
        terminalId: payload.terminalId ?? null,
        cashierEmployeeId: payload.cashierEmployeeId ?? null,
        ticketId: payload.ticketId,
        purchaseAmountCents: payload.ticketAmountCents,
        couponUsedId: coupon.id,
        source: 'POS_SCAN',
      });

      // 6. Update customer stats
      await mgr.query(
        `UPDATE customers SET visit_count = visit_count + 1, last_visit_at = now() WHERE id = $1`,
        [payload.customerId],
      );

      // 7. Audit
      await this.auditService.log({
        storeId: payload.storeId,
        employeeId: payload.cashierEmployeeId ?? 'system',
        action: 'COUPON_REDEEMED',
        entityType: 'coupon',
        entityId: coupon.id,
        details: {
          actorType: 'POS',
          customerId: payload.customerId,
          ticketId: payload.ticketId,
          discountPercent: coupon.discount_value,
          terminalId: payload.terminalId,
        },
      });

      const response = {
        success: true as const,
        discountPercent: coupon.discount_value,
        couponId: coupon.id,
      };

      // 8. Cache idempotency
      const expiresAt = new Date();
      expiresAt.setHours(expiresAt.getHours() + 24);
      await mgr.insert(IdempotencyKeyEntity, {
        key: idempotencyKey,
        endpoint: '/pos/loyalty/redeem',
        customerId: payload.customerId,
        responseStatus: 200,
        responseBody: response,
        expiresAt,
      });

      return response;
    });
  }

  /**
   * Issue next loyalty coupon (cron or manual).
   * Called when cooldown expires for a customer who used a coupon.
   */
  async issueNextLoyaltyCoupon(customerId: string): Promise<CouponEntity> {
    const next = await this.calculateNextReward(customerId);
    if (!next.eligible) {
      throw new ConflictException(next.reason ?? 'Pas encore éligible');
    }

    const validUntil = new Date();
    validUntil.setDate(validUntil.getDate() + COUPON_VALIDITY_DAYS);

    const usedCount = await this.couponRepo.count({
      where: { customerId, status: 'USED' },
    });
    const cycle = await this.getCycleForRank(usedCount + 1);

    const coupon = this.couponRepo.create({
      customerId,
      type: 'LOYALTY',
      discountType: 'PERCENT',
      discountValue: cycle?.discountPercent ?? 5,
      status: 'AVAILABLE',
      validFrom: new Date(),
      validUntil,
      visitRankWhenEmitted: usedCount + 1,
      cycleId: cycle?.id ?? null,
    });
    return this.couponRepo.save(coupon);
  }
}
