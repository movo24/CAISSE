import {
  Injectable,
  Logger,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Repository } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { SubscriptionEntity } from '../../database/entities/subscription.entity';
import { ProductEntity } from '../../database/entities/product.entity';
import { EmployeeEntity } from '../../database/entities/employee.entity';
import { AuditService } from '../audit/audit.service';

// ---------------------------------------------------------------------------
// Plan definitions
// ---------------------------------------------------------------------------
export interface PlanDefinition {
  name: string;
  priceMonthlyMinorUnits: number;
  priceYearlyMinorUnits: number;
  maxTerminals: number;
  maxProducts: number;
  maxEmployees: number;
  features: string[];
}

export const PLAN_CATALOG: Record<string, PlanDefinition> = {
  trial: {
    name: 'Essai Gratuit',
    priceMonthlyMinorUnits: 0,
    priceYearlyMinorUnits: 0,
    maxTerminals: 1,
    maxProducts: 100,
    maxEmployees: 2,
    features: ['pos_basic', 'reports_basic'],
  },
  starter: {
    name: 'Starter',
    priceMonthlyMinorUnits: 4900, // 49.00 EUR
    priceYearlyMinorUnits: 47000, // 470.00 EUR (2 mois offerts)
    maxTerminals: 1,
    maxProducts: 500,
    maxEmployees: 5,
    features: ['pos_basic', 'reports_basic', 'promotions', 'loyalty_basic'],
  },
  business: {
    name: 'Business',
    priceMonthlyMinorUnits: 9900, // 99.00 EUR
    priceYearlyMinorUnits: 95000, // 950.00 EUR
    maxTerminals: 3,
    maxProducts: -1, // illimite
    maxEmployees: 15,
    features: [
      'pos_basic',
      'pos_dual_screen',
      'reports_full',
      'promotions',
      'loyalty_full',
      'ia_pricing',
      'ia_forecast',
      'multi_currency',
      'stock_alerts',
    ],
  },
  enterprise: {
    name: 'Enterprise',
    priceMonthlyMinorUnits: 24900, // 249.00 EUR
    priceYearlyMinorUnits: 239000, // 2390.00 EUR
    maxTerminals: -1, // illimite
    maxProducts: -1,
    maxEmployees: -1,
    features: [
      'pos_basic',
      'pos_dual_screen',
      'reports_full',
      'reports_export',
      'promotions',
      'loyalty_full',
      'ia_pricing',
      'ia_forecast',
      'multi_currency',
      'stock_alerts',
      'api_access',
      'white_label',
      'priority_support',
      'multi_store',
      'audit_export',
    ],
  },
};

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------
@Injectable()
export class SubscriptionsService {
  private readonly logger = new Logger(SubscriptionsService.name);

  constructor(
    @InjectRepository(SubscriptionEntity)
    private readonly subRepo: Repository<SubscriptionEntity>,

    @InjectRepository(ProductEntity)
    private readonly productsRepo: Repository<ProductEntity>,

    @InjectRepository(EmployeeEntity)
    private readonly employeesRepo: Repository<EmployeeEntity>,

    private readonly auditService: AuditService,
  ) {}

  // -----------------------------------------------------------------------
  // Create trial subscription for a new store
  // -----------------------------------------------------------------------
  async createTrialForStore(storeId: string): Promise<SubscriptionEntity> {
    const existing = await this.subRepo.findOne({ where: { storeId } });
    if (existing) {
      throw new BadRequestException('Store already has a subscription');
    }

    const trialDays = 14;
    const trialEndsAt = new Date();
    trialEndsAt.setDate(trialEndsAt.getDate() + trialDays);

    const plan = PLAN_CATALOG.trial;
    const sub = this.subRepo.create({
      id: uuidv4(),
      storeId,
      plan: 'trial',
      status: 'trial',
      priceMinorUnits: 0,
      currencyCode: 'EUR',
      billingCycle: 'monthly',
      trialEndsAt,
      currentPeriodStart: new Date(),
      currentPeriodEnd: trialEndsAt,
      maxTerminals: plan.maxTerminals,
      maxProducts: plan.maxProducts,
      maxEmployees: plan.maxEmployees,
      featuresEnabled: plan.features,
    });

    const saved = await this.subRepo.save(sub);

    this.logger.log(
      `Trial subscription created for store ${storeId}, expires ${trialEndsAt.toISOString()}`,
    );

    return saved;
  }

  // -----------------------------------------------------------------------
  // Upgrade / change plan
  // -----------------------------------------------------------------------
  async changePlan(
    storeId: string,
    newPlan: string,
    billingCycle: 'monthly' | 'yearly' = 'monthly',
  ): Promise<SubscriptionEntity> {
    const sub = await this.getByStoreId(storeId);
    const planDef = PLAN_CATALOG[newPlan];
    if (!planDef) {
      throw new BadRequestException(`Unknown plan: ${newPlan}`);
    }

    const oldPlan = sub.plan;
    const price =
      billingCycle === 'yearly'
        ? planDef.priceYearlyMinorUnits
        : planDef.priceMonthlyMinorUnits;

    // Set new period
    const now = new Date();
    const periodEnd = new Date(now);
    if (billingCycle === 'yearly') {
      periodEnd.setFullYear(periodEnd.getFullYear() + 1);
    } else {
      periodEnd.setMonth(periodEnd.getMonth() + 1);
    }

    sub.plan = newPlan as any;
    sub.status = 'active';
    sub.priceMinorUnits = price;
    sub.billingCycle = billingCycle;
    sub.currentPeriodStart = now;
    sub.currentPeriodEnd = periodEnd;
    sub.maxTerminals = planDef.maxTerminals;
    sub.maxProducts = planDef.maxProducts;
    sub.maxEmployees = planDef.maxEmployees;
    sub.featuresEnabled = planDef.features;

    const saved = await this.subRepo.save(sub);

    await this.auditService.log({
      storeId,
      employeeId: 'system',
      action: 'subscription_changed' as any,
      entityType: 'subscription',
      entityId: saved.id,
      details: {
        oldPlan,
        newPlan,
        billingCycle,
        priceMinorUnits: price,
      },
    });

    this.logger.log(
      `Store ${storeId}: ${oldPlan} → ${newPlan} (${billingCycle})`,
    );

    // Billing is now handled via StripeBillingService (Checkout Sessions).
    // This method only updates the local subscription record.
    if (price > 0) {
      this.logger.log(
        `[BILLING] Plan change recorded: ${price / 100} EUR for store ${storeId}. Use Stripe Checkout for payment.`,
      );
    }

    return saved;
  }

  // -----------------------------------------------------------------------
  // Cancel subscription
  // -----------------------------------------------------------------------
  async cancel(storeId: string): Promise<SubscriptionEntity> {
    const sub = await this.getByStoreId(storeId);
    if (sub.status === 'cancelled') {
      throw new BadRequestException('Subscription already cancelled');
    }

    sub.status = 'cancelled';
    sub.cancelledAt = new Date();
    // Access remains until current_period_end

    const saved = await this.subRepo.save(sub);

    await this.auditService.log({
      storeId,
      employeeId: 'system',
      action: 'subscription_cancelled' as any,
      entityType: 'subscription',
      entityId: saved.id,
      details: {
        plan: sub.plan,
        effectiveUntil: sub.currentPeriodEnd,
      },
    });

    this.logger.log(
      `Store ${storeId}: subscription cancelled, active until ${sub.currentPeriodEnd}`,
    );

    return saved;
  }

  // -----------------------------------------------------------------------
  // Enforcement — check limits before operations
  // -----------------------------------------------------------------------
  async enforceProductLimit(storeId: string): Promise<void> {
    const sub = await this.getByStoreId(storeId);
    this.assertActive(sub);

    if (sub.maxProducts === -1) return; // unlimited

    const count = await this.productsRepo.count({
      where: { storeId, isActive: true },
    });
    if (count >= sub.maxProducts) {
      throw new ForbiddenException(
        `Product limit reached (${sub.maxProducts}). ` +
          `Upgrade to ${this.suggestUpgrade(sub.plan)} for more.`,
      );
    }
  }

  async enforceEmployeeLimit(storeId: string): Promise<void> {
    const sub = await this.getByStoreId(storeId);
    this.assertActive(sub);

    if (sub.maxEmployees === -1) return;

    const count = await this.employeesRepo.count({
      where: { storeId, isActive: true },
    });
    if (count >= sub.maxEmployees) {
      throw new ForbiddenException(
        `Employee limit reached (${sub.maxEmployees}). ` +
          `Upgrade to ${this.suggestUpgrade(sub.plan)} for more.`,
      );
    }
  }

  async enforceFeature(storeId: string, feature: string): Promise<void> {
    const sub = await this.getByStoreId(storeId);
    this.assertActive(sub);

    if (!sub.featuresEnabled.includes(feature)) {
      throw new ForbiddenException(
        `Feature "${feature}" is not available on the ${sub.plan} plan. ` +
          `Upgrade to unlock this feature.`,
      );
    }
  }

  // -----------------------------------------------------------------------
  // Read operations
  // -----------------------------------------------------------------------
  async getByStoreId(storeId: string): Promise<SubscriptionEntity> {
    const sub = await this.subRepo.findOne({ where: { storeId } });
    if (!sub) {
      throw new NotFoundException(`No subscription found for store ${storeId}`);
    }
    return sub;
  }

  async getUsage(storeId: string): Promise<{
    plan: string;
    status: string;
    products: { used: number; limit: number };
    employees: { used: number; limit: number };
    terminals: { used: number; limit: number };
    features: string[];
    billing: {
      priceMinorUnits: number;
      currencyCode: string;
      billingCycle: string;
      currentPeriodEnd: Date;
    };
  }> {
    const sub = await this.getByStoreId(storeId);

    const [productCount, employeeCount] = await Promise.all([
      this.productsRepo.count({ where: { storeId, isActive: true } }),
      this.employeesRepo.count({ where: { storeId, isActive: true } }),
    ]);

    return {
      plan: sub.plan,
      status: sub.status,
      products: {
        used: productCount,
        limit: sub.maxProducts,
      },
      employees: {
        used: employeeCount,
        limit: sub.maxEmployees,
      },
      terminals: {
        used: 1, // MVP: track active terminals in V1
        limit: sub.maxTerminals,
      },
      features: sub.featuresEnabled,
      billing: {
        priceMinorUnits: sub.priceMinorUnits,
        currencyCode: sub.currencyCode,
        billingCycle: sub.billingCycle,
        currentPeriodEnd: sub.currentPeriodEnd,
      },
    };
  }

  getPlans(): Record<string, PlanDefinition> {
    return PLAN_CATALOG;
  }

  // -----------------------------------------------------------------------
  // Check expired trials / past due — runs daily at 02:00 UTC
  // -----------------------------------------------------------------------
  @Cron(CronExpression.EVERY_DAY_AT_2AM)
  async checkExpiredSubscriptions(): Promise<number> {
    const now = new Date();

    // Expire trials
    const expiredTrials = await this.subRepo
      .createQueryBuilder()
      .update()
      .set({ status: 'suspended' })
      .where('status = :status', { status: 'trial' })
      .andWhere('trial_ends_at < :now', { now })
      .execute();

    // Suspend past_due beyond grace period (7 days after period end)
    const graceCutoff = new Date(now);
    graceCutoff.setDate(graceCutoff.getDate() - 7);

    const pastDue = await this.subRepo
      .createQueryBuilder()
      .update()
      .set({ status: 'suspended' })
      .where('status = :status', { status: 'past_due' })
      .andWhere('current_period_end < :cutoff', { cutoff: graceCutoff })
      .execute();

    const total =
      (expiredTrials.affected || 0) + (pastDue.affected || 0);

    if (total > 0) {
      this.logger.warn(`Suspended ${total} subscriptions (${expiredTrials.affected} trials, ${pastDue.affected} past_due)`);
    }

    return total;
  }

  // -----------------------------------------------------------------------
  // Helpers
  // -----------------------------------------------------------------------
  private assertActive(sub: SubscriptionEntity): void {
    if (sub.status === 'suspended') {
      throw new ForbiddenException(
        'Subscription is suspended. Please renew your plan to continue.',
      );
    }
    if (sub.status === 'cancelled') {
      // Check if still in grace period
      if (sub.currentPeriodEnd && sub.currentPeriodEnd < new Date()) {
        throw new ForbiddenException(
          'Subscription has expired. Please renew your plan.',
        );
      }
    }
  }

  private suggestUpgrade(currentPlan: string): string {
    const upgrades: Record<string, string> = {
      trial: 'Starter',
      starter: 'Business',
      business: 'Enterprise',
      enterprise: 'Enterprise', // already top
    };
    return upgrades[currentPlan] || 'Business';
  }
}
