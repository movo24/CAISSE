import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException } from '@nestjs/common';

import { StripeBillingService } from './stripe-billing.service';
import { SubscriptionEntity } from '../../database/entities/subscription.entity';
import { StoreEntity } from '../../database/entities/store.entity';

// PAQUET 267 — Stripe billing guards. DI-mocked (fake Stripe object). Locks the
// pre-call guards that protect real money flows: not-configured, unknown plan,
// free-plan checkout refusal, missing customer for portal, and the webhook
// secret requirement (fail-closed — never trust an unverifiable webhook).

const makeModule = async (stripe: any) => {
  const subRepo = { findOne: jest.fn(), save: jest.fn() };
  const storeRepo = { findOne: jest.fn() };
  const module: TestingModule = await Test.createTestingModule({
    providers: [
      StripeBillingService,
      { provide: 'STRIPE', useValue: stripe },
      { provide: getRepositoryToken(SubscriptionEntity), useValue: subRepo },
      { provide: getRepositoryToken(StoreEntity), useValue: storeRepo },
    ],
  }).compile();
  return { service: module.get(StripeBillingService), subRepo, storeRepo };
};

describe('StripeBillingService — guards', () => {
  const stripe = {}; // truthy → configured

  it('throws when Stripe is not configured (null client)', async () => {
    const { service } = await makeModule(null);
    await expect(
      service.createCheckoutSession('s1', 'business', 'monthly', 'ok', 'cancel'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects an unknown plan', async () => {
    const { service } = await makeModule(stripe);
    await expect(
      service.createCheckoutSession('s1', 'platinum', 'monthly', 'ok', 'cancel'),
    ).rejects.toThrow(/Unknown plan/);
  });

  it('refuses to checkout a free plan via Stripe', async () => {
    const { service } = await makeModule(stripe);
    await expect(
      service.createCheckoutSession('s1', 'trial', 'monthly', 'ok', 'cancel'),
    ).rejects.toThrow(/free plan/);
  });

  it('createPortalSession throws when the store has no Stripe customer', async () => {
    const { service, subRepo } = await makeModule(stripe);
    subRepo.findOne.mockResolvedValue({ id: 'sub-1' }); // no stripeCustomerId
    await expect(service.createPortalSession('s1', 'return')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('handleWebhook fails closed when STRIPE_WEBHOOK_SECRET is not set', async () => {
    const prev = process.env.STRIPE_WEBHOOK_SECRET;
    delete process.env.STRIPE_WEBHOOK_SECRET;
    try {
      const { service } = await makeModule(stripe);
      await expect(service.handleWebhook(Buffer.from('{}'), 'sig')).rejects.toThrow(/secret not configured/);
    } finally {
      if (prev !== undefined) process.env.STRIPE_WEBHOOK_SECRET = prev;
    }
  });
});
