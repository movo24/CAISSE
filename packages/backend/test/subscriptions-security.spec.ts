/**
 * Subscriptions — security spec (tests-as-spec).
 *  - changePlan must NOT grant a paid plan's active status/entitlements without payment
 *    (paid activation only via Stripe checkout → verified-paid webhook);
 *  - the sensitive routes (change-plan / cancel / trial) must require @Roles('admin');
 *  - trial creation characterized.
 */
import './helpers/env-setup';
import { DataSource, Repository } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { BadRequestException } from '@nestjs/common';
import { createPgMemDataSource } from './helpers/pgmem';
import { SubscriptionsService } from '../src/modules/subscriptions/subscriptions.service';
import { SubscriptionsController } from '../src/modules/subscriptions/subscriptions.controller';
import { ROLES_KEY } from '../src/common/guards/roles.guard';
import { SubscriptionEntity } from '../src/database/entities/subscription.entity';
import { ProductEntity } from '../src/database/entities/product.entity';
import { StoreEntity } from '../src/database/entities/store.entity';

describe('Subscriptions — security', () => {
  let ds: DataSource;
  let subRepo: Repository<SubscriptionEntity>;
  let svc: SubscriptionsService;
  const STORE = uuidv4();
  const timewin = { syncEmployees: jest.fn().mockResolvedValue([]), getCachedEmployees: jest.fn().mockReturnValue([]) };
  const audit = { log: jest.fn().mockResolvedValue(undefined) };

  beforeAll(async () => {
    const { dataSource } = createPgMemDataSource();
    ds = await dataSource.initialize();
    subRepo = ds.getRepository(SubscriptionEntity);
    svc = new SubscriptionsService(subRepo as any, ds.getRepository(ProductEntity) as any, timewin as any, audit as any);
    await ds.getRepository(StoreEntity).save({ id: STORE, name: 'Store', storeCode: 'B1', currencyCode: 'EUR', isActive: true } as any);
  });
  afterAll(async () => { await ds?.destroy(); });
  beforeEach(async () => {
    await ds.query('DELETE FROM subscriptions');
    await subRepo.save({
      id: uuidv4(), storeId: STORE, plan: 'trial', status: 'trial', priceMinorUnits: 0,
      currencyCode: 'EUR', billingCycle: 'monthly', maxTerminals: 1, maxProducts: 100, maxEmployees: 2,
      featuresEnabled: ['pos_basic'], currentPeriodStart: new Date(), currentPeriodEnd: new Date(),
    } as any);
  });

  describe('changePlan capture invariant', () => {
    it('refuses to activate a PAID plan directly (no payment) — must go via Stripe checkout', async () => {
      await expect(svc.changePlan(STORE, 'business', 'monthly')).rejects.toBeInstanceOf(BadRequestException);
      const sub = await subRepo.findOneByOrFail({ storeId: STORE });
      expect(sub.status).toBe('trial'); // unchanged — no free Business
      expect(sub.plan).toBe('trial');
      expect(sub.featuresEnabled).not.toContain('ia_pricing');
    });

    it('refuses paid enterprise the same way', async () => {
      await expect(svc.changePlan(STORE, 'enterprise', 'yearly')).rejects.toBeInstanceOf(BadRequestException);
      expect((await subRepo.findOneByOrFail({ storeId: STORE })).status).toBe('trial');
    });

    it('rejects an unknown plan', async () => {
      await expect(svc.changePlan(STORE, 'platinum')).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('createTrialForStore', () => {
    it('creates a trial (status=trial, price 0) and refuses a duplicate', async () => {
      await ds.query('DELETE FROM subscriptions');
      const sub = await svc.createTrialForStore(STORE);
      expect(sub.status).toBe('trial');
      expect(sub.priceMinorUnits).toBe(0);
      await expect(svc.createTrialForStore(STORE)).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('controller RBAC — sensitive routes require @Roles("admin")', () => {
    const rolesOf = (m: keyof SubscriptionsController) =>
      Reflect.getMetadata(ROLES_KEY, SubscriptionsController.prototype[m] as any);
    it('change-plan requires admin', () => { expect(rolesOf('changePlan')).toEqual(['admin']); });
    it('cancel requires admin', () => { expect(rolesOf('cancel')).toEqual(['admin']); });
    it('trial requires admin', () => { expect(rolesOf('createTrial')).toEqual(['admin']); });
    it('checkout + portal already require admin (regression guard)', () => {
      expect(rolesOf('createCheckout')).toEqual(['admin']);
      expect(rolesOf('createPortal')).toEqual(['admin']);
    });
  });
});
