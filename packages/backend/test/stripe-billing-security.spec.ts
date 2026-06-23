/**
 * Stripe billing — security / capture-invariant spec (tests-as-spec).
 *
 * Proves the payment invariants the GO-prep flagged as VIOLATED. Written against
 * the intended behavior; several are RED on the pre-fix code and GREEN after the fix:
 *  - webhook activates ONLY on payment_status==='paid';
 *  - charged amount/currency must match the plan before activation;
 *  - webhook idempotency is DURABLE (survives a new service instance), not in-memory;
 *  - invalid signature / missing secret are rejected.
 *
 * Stripe is a mock — no live API, no real payment.
 */
import './helpers/env-setup';
import { DataSource, Repository } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { BadRequestException } from '@nestjs/common';
import { createPgMemDataSource } from './helpers/pgmem';
import { StripeBillingService } from '../src/modules/subscriptions/stripe-billing.service';
import { SubscriptionEntity } from '../src/database/entities/subscription.entity';
import { StoreEntity } from '../src/database/entities/store.entity';
import { IdempotencyKeyEntity } from '../src/database/entities/idempotency-key.entity';

describe('StripeBillingService — capture invariant & webhook security', () => {
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
    await subRepo.save({
      id: uuidv4(), storeId: STORE, plan: 'trial', status: 'trial', priceMinorUnits: 0,
      currencyCode: 'EUR', billingCycle: 'monthly', maxTerminals: 1, maxProducts: 100, maxEmployees: 2,
      featuresEnabled: [], currentPeriodStart: new Date(), currentPeriodEnd: new Date(),
    } as any);
  });

  // Single construction point — flip to the 4-arg form when the durable-idempotency fix lands.
  const makeSvc = (stripe: any) =>
    new StripeBillingService(stripe, subRepo as any, storeRepo as any, idemRepo as any);

  const mkStripe = (event: any) => ({
    webhooks: { constructEvent: jest.fn().mockReturnValue(event) },
    customers: { create: jest.fn() },
    checkout: { sessions: { create: jest.fn() } },
    billingPortal: { sessions: { create: jest.fn() } },
  });

  const checkoutEvent = (over: any = {}) => ({
    id: over.id || `evt_${uuidv4()}`,
    type: 'checkout.session.completed',
    data: { object: {
      metadata: { storeId: STORE, plan: 'business', billingCycle: 'monthly' },
      payment_status: 'paid',
      amount_total: 9900,            // business monthly = 9900
      currency: 'eur',
      customer: 'cus_1',
      subscription: 'sub_1',
      ...over.session,
    } },
  });

  const status = async () => (await subRepo.findOneByOrFail({ storeId: STORE })).status;

  it('does NOT activate when payment_status !== "paid" (capture invariant)', async () => {
    const svc = makeSvc(mkStripe(checkoutEvent({ session: { payment_status: 'unpaid' } })));
    await svc.handleWebhook(Buffer.from('x'), 'sig');
    expect(await status()).toBe('trial'); // unpaid → no activation
  });

  it('activates and grants entitlements on a paid, amount-matching session', async () => {
    const svc = makeSvc(mkStripe(checkoutEvent()));
    await svc.handleWebhook(Buffer.from('x'), 'sig');
    const sub = await subRepo.findOneByOrFail({ storeId: STORE });
    expect(sub.status).toBe('active');
    expect(sub.plan).toBe('business');
    expect(sub.featuresEnabled).toContain('ia_pricing');
  });

  it('does NOT activate when the charged amount does not match the plan price', async () => {
    const svc = makeSvc(mkStripe(checkoutEvent({ session: { amount_total: 100 } }))); // 1.00 instead of 99.00
    await svc.handleWebhook(Buffer.from('x'), 'sig');
    expect(await status()).toBe('trial');
  });

  it('does NOT activate when the currency does not match', async () => {
    const svc = makeSvc(mkStripe(checkoutEvent({ session: { currency: 'usd' } })));
    await svc.handleWebhook(Buffer.from('x'), 'sig');
    expect(await status()).toBe('trial');
  });

  it('rejects an invalid signature and writes nothing', async () => {
    const stripe = { webhooks: { constructEvent: jest.fn(() => { throw new Error('bad sig'); }) } };
    const svc = makeSvc(stripe);
    await expect(svc.handleWebhook(Buffer.from('x'), 'sig')).rejects.toBeInstanceOf(BadRequestException);
    expect(await status()).toBe('trial');
  });

  it('throws when STRIPE_WEBHOOK_SECRET is missing (no silent processing)', async () => {
    const saved = process.env.STRIPE_WEBHOOK_SECRET;
    delete process.env.STRIPE_WEBHOOK_SECRET;
    const svc = makeSvc(mkStripe(checkoutEvent()));
    await expect(svc.handleWebhook(Buffer.from('x'), 'sig')).rejects.toThrow();
    process.env.STRIPE_WEBHOOK_SECRET = saved;
  });

  it('idempotency is DURABLE — a second service instance does not re-process the same event', async () => {
    const evt = checkoutEvent({ id: 'evt_dup' });
    await makeSvc(mkStripe(evt)).handleWebhook(Buffer.from('x'), 'sig'); // instance 1 → active
    expect(await status()).toBe('active');
    // Simulate a downstream state change, then redeliver the SAME event to a FRESH instance.
    await subRepo.update({ storeId: STORE }, { status: 'past_due' });
    await makeSvc(mkStripe(evt)).handleWebhook(Buffer.from('x'), 'sig'); // instance 2, same event.id
    expect(await status()).toBe('past_due'); // durable dedup → NOT re-activated
  });
});
