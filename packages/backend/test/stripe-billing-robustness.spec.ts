/**
 * Stripe billing — robustness round 2 (tests-as-spec).
 *  - a verified-PAID checkout for a store with no local sub row must still yield
 *    entitlement (upsert), but ONLY after the capture guards pass;
 *  - createCheckoutSession sends an idempotency key on the Stripe customer create so a
 *    retry reuses the same customer (no duplicate / no lost id).
 * Stripe is mocked — no live API, no real payment.
 */
import './helpers/env-setup';
import { DataSource, Repository } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { createPgMemDataSource } from './helpers/pgmem';
import { StripeBillingService } from '../src/modules/subscriptions/stripe-billing.service';
import { SubscriptionEntity } from '../src/database/entities/subscription.entity';
import { StoreEntity } from '../src/database/entities/store.entity';
import { IdempotencyKeyEntity } from '../src/database/entities/idempotency-key.entity';

describe('StripeBillingService — robustness (upsert + idempotency keys)', () => {
  let ds: DataSource;
  let subRepo: Repository<SubscriptionEntity>;
  let storeRepo: Repository<StoreEntity>;
  let idemRepo: Repository<IdempotencyKeyEntity>;
  const STORE = uuidv4();

  beforeAll(async () => {
    const { dataSource } = createPgMemDataSource();
    ds = await dataSource.initialize();
    subRepo = ds.getRepository(SubscriptionEntity);
    storeRepo = ds.getRepository(StoreEntity);
    idemRepo = ds.getRepository(IdempotencyKeyEntity);
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test';
  });
  afterAll(async () => { await ds?.destroy(); });
  beforeEach(async () => {
    await ds.query('DELETE FROM subscriptions');
    await ds.query('DELETE FROM idempotency_keys');
    await storeRepo.save({ id: STORE, name: 'Store', storeCode: 'B1', currencyCode: 'EUR', isActive: true } as any);
  });

  const makeSvc = (stripe: any) =>
    new StripeBillingService(stripe, subRepo as any, storeRepo as any, idemRepo as any);

  const checkoutEvent = (over: any = {}) => ({
    id: over.id || `evt_${uuidv4()}`,
    type: 'checkout.session.completed',
    data: { object: {
      metadata: { storeId: STORE, plan: 'business', billingCycle: 'monthly' },
      payment_status: 'paid', amount_total: 9900, currency: 'eur',
      customer: 'cus_1', subscription: 'sub_1', ...over.session,
    } },
  });
  const mkStripe = (event: any) => ({ webhooks: { constructEvent: jest.fn().mockReturnValue(event) } });

  describe('paid checkout with NO existing subscription', () => {
    it('creates and activates a subscription (paid customer must be entitled)', async () => {
      expect(await subRepo.findOne({ where: { storeId: STORE } })).toBeNull();
      await makeSvc(mkStripe(checkoutEvent())).handleWebhook(Buffer.from('x'), 'sig');
      const sub = await subRepo.findOne({ where: { storeId: STORE } });
      expect(sub).not.toBeNull();
      expect(sub!.status).toBe('active');
      expect(sub!.plan).toBe('business');
      expect(sub!.featuresEnabled).toContain('ia_pricing');
    });

    it('does NOT create a subscription when the checkout is unpaid (guards run before upsert)', async () => {
      await makeSvc(mkStripe(checkoutEvent({ session: { payment_status: 'unpaid' } }))).handleWebhook(Buffer.from('x'), 'sig');
      expect(await subRepo.findOne({ where: { storeId: STORE } })).toBeNull();
    });

    it('does NOT create a subscription when the amount does not match', async () => {
      await makeSvc(mkStripe(checkoutEvent({ session: { amount_total: 1 } }))).handleWebhook(Buffer.from('x'), 'sig');
      expect(await subRepo.findOne({ where: { storeId: STORE } })).toBeNull();
    });
  });

  describe('createCheckoutSession idempotency', () => {
    it('passes an idempotency key on the Stripe customer create (retry reuses the customer)', async () => {
      const stripe: any = {
        customers: { create: jest.fn().mockResolvedValue({ id: 'cus_new' }) },
        checkout: { sessions: { create: jest.fn().mockResolvedValue({ id: 'cs_1', url: 'https://stripe/cs_1' }) } },
      };
      await makeSvc(stripe).createCheckoutSession(STORE, 'business', 'monthly', 'https://ok', 'https://cancel');
      expect(stripe.customers.create).toHaveBeenCalledTimes(1);
      const [, opts] = stripe.customers.create.mock.calls[0];
      expect(opts).toMatchObject({ idempotencyKey: expect.stringContaining(STORE) });
    });
  });
});
