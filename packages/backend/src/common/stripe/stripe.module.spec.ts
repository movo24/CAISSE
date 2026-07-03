import { Test } from '@nestjs/testing';
import Stripe from 'stripe';
import { StripeModule } from './stripe.module';

/**
 * P365 — Stripe provider fail-safe contract (key present / absent).
 *
 * The 'STRIPE' provider must return `null` (Stripe disabled) when STRIPE_SECRET_KEY
 * is unset, so the app boots without Stripe configured — payment endpoints refuse
 * later, but startup never fails. With a key set, a real Stripe client is provided.
 *
 * The fake key is CONSTRUCTED at runtime (concatenation) so no literal secret-shaped
 * token ever appears in this source file (source-no-secrets guard).
 */
describe('StripeModule — STRIPE provider fail-safe', () => {
  const saved = process.env.STRIPE_SECRET_KEY;

  afterEach(() => {
    if (saved === undefined) delete process.env.STRIPE_SECRET_KEY;
    else process.env.STRIPE_SECRET_KEY = saved;
  });

  it('provides null (Stripe disabled) when STRIPE_SECRET_KEY is absent — app still boots', async () => {
    delete process.env.STRIPE_SECRET_KEY;
    const moduleRef = await Test.createTestingModule({ imports: [StripeModule] }).compile();
    expect(moduleRef.get('STRIPE')).toBeNull();
    await moduleRef.close();
  });

  it('provides a real Stripe client when STRIPE_SECRET_KEY is set', async () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_' + 'x'.repeat(24); // constructed → no literal secret in source
    const moduleRef = await Test.createTestingModule({ imports: [StripeModule] }).compile();
    const client = moduleRef.get('STRIPE');
    expect(client).toBeInstanceOf(Stripe);
    await moduleRef.close();
  });
});
