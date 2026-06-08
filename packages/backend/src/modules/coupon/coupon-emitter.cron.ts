import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CustomerEntity } from '../../database/entities/customer.entity';
import { CouponEntity } from '../../database/entities/coupon.entity';
import { CouponService } from './coupon.service';

/**
 * Daily cron — emits the next loyalty coupon to customers whose 15-day
 * cooldown has expired AND who don't already have an AVAILABLE coupon.
 *
 * Runs at 06:00 server time. Limits to 500 customers per run to avoid
 * hammering APNs (push will be sent in batch by NotificationsService).
 */
@Injectable()
export class CouponEmitterCron {
  private readonly logger = new Logger(CouponEmitterCron.name);
  private static readonly BATCH_SIZE = 500;
  private static readonly COOLDOWN_DAYS = 15;

  constructor(
    @InjectRepository(CustomerEntity)
    private readonly customerRepo: Repository<CustomerEntity>,
    @InjectRepository(CouponEntity)
    private readonly couponRepo: Repository<CouponEntity>,
    private readonly couponService: CouponService,
  ) {}

  @Cron('0 6 * * *', { name: 'coupon-emitter', timeZone: 'Europe/Paris' })
  async emitDailyCoupons(): Promise<void> {
    this.logger.log('coupon-emitter cron started');
    const startedAt = Date.now();

    // Find candidates: active customers whose last USED coupon is > 15 days old
    // AND who have no AVAILABLE coupon currently.
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - CouponEmitterCron.COOLDOWN_DAYS);

    const candidates = await this.customerRepo
      .createQueryBuilder('c')
      .where('c.deletedAt IS NULL')
      .andWhere(
        `NOT EXISTS (
          SELECT 1 FROM coupons cp
          WHERE cp.customer_id = c.id
            AND cp.status = 'AVAILABLE'
            AND (cp.valid_until IS NULL OR cp.valid_until > now())
        )`,
      )
      .andWhere(
        `EXISTS (
          SELECT 1 FROM coupons cp
          WHERE cp.customer_id = c.id
            AND cp.status = 'USED'
            AND cp.used_at <= :cutoff
        )`,
        { cutoff },
      )
      .limit(CouponEmitterCron.BATCH_SIZE)
      .getMany();

    let issued = 0;
    let errors = 0;

    for (const customer of candidates) {
      try {
        await this.couponService.issueNextLoyaltyCoupon(customer.id);
        issued++;
      } catch (err: any) {
        errors++;
        this.logger.warn(
          `coupon-emitter: skipped customer ${customer.id}: ${err?.message ?? err}`,
        );
      }
    }

    const durationMs = Date.now() - startedAt;
    this.logger.log(
      `coupon-emitter done in ${durationMs}ms — issued=${issued} errors=${errors} candidates=${candidates.length}`,
    );
  }

  /**
   * Daily cron — expires AVAILABLE coupons whose valid_until has passed.
   * Runs at 23:30 server time.
   */
  @Cron('30 23 * * *', { name: 'coupon-expiry', timeZone: 'Europe/Paris' })
  async expireOldCoupons(): Promise<void> {
    const result = await this.couponRepo
      .createQueryBuilder()
      .update()
      .set({ status: 'EXPIRED' })
      .where('status = :status', { status: 'AVAILABLE' })
      .andWhere('valid_until IS NOT NULL AND valid_until < :now', {
        now: new Date(),
      })
      .execute();

    this.logger.log(`coupon-expiry: marked ${result.affected ?? 0} coupons EXPIRED`);
  }
}
