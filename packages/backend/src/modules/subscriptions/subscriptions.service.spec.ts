import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';

import { SubscriptionsService } from './subscriptions.service';
import { SubscriptionEntity } from '../../database/entities/subscription.entity';
import { ProductEntity } from '../../database/entities/product.entity';
import { TimewinService } from '../timewin/timewin.service';
import { AuditService } from '../audit/audit.service';

// PAQUET 264 — subscription lifecycle + plan-limit enforcement. DI-mocked.
// Locks: single-subscription-per-store, unknown-plan guard, double-cancel guard,
// product-limit enforcement (unlimited bypass / within / over), feature gate,
// and the not-found read. Denial/limit maths live in subscription-policy.spec.

const future = () => new Date(Date.now() + 30 * 24 * 3600 * 1000);

describe('SubscriptionsService', () => {
  let service: SubscriptionsService;
  let subRepo: { findOne: jest.Mock; create: jest.Mock; save: jest.Mock };
  let productsRepo: { count: jest.Mock };
  let audit: { log: jest.Mock };

  beforeEach(async () => {
    subRepo = {
      findOne: jest.fn(),
      create: jest.fn((x) => x),
      save: jest.fn((x) => Promise.resolve({ id: 'sub-1', ...x })),
    };
    productsRepo = { count: jest.fn() };
    audit = { log: jest.fn().mockResolvedValue(undefined) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SubscriptionsService,
        { provide: getRepositoryToken(SubscriptionEntity), useValue: subRepo },
        { provide: getRepositoryToken(ProductEntity), useValue: productsRepo },
        { provide: TimewinService, useValue: {} },
        { provide: AuditService, useValue: audit },
      ],
    }).compile();

    service = module.get(SubscriptionsService);
  });

  describe('createTrialForStore', () => {
    it('refuses a second subscription for the store', async () => {
      subRepo.findOne.mockResolvedValue({ id: 'existing' });
      await expect(service.createTrialForStore('s1')).rejects.toBeInstanceOf(BadRequestException);
    });
    it('creates a trial with the trial plan limits', async () => {
      subRepo.findOne.mockResolvedValue(null);
      const sub = await service.createTrialForStore('s1');
      expect(sub).toMatchObject({ plan: 'trial', status: 'trial', maxProducts: 100, maxEmployees: 2 });
    });
  });

  describe('changePlan', () => {
    it('rejects an unknown plan', async () => {
      subRepo.findOne.mockResolvedValue({ id: 'sub-1', storeId: 's1', plan: 'trial' });
      await expect(service.changePlan('s1', 'platinum')).rejects.toBeInstanceOf(BadRequestException);
    });
    it('applies the business plan (monthly price) and writes an audit entry', async () => {
      subRepo.findOne.mockResolvedValue({ id: 'sub-1', storeId: 's1', plan: 'trial' });
      const saved = await service.changePlan('s1', 'business', 'monthly');
      expect(saved).toMatchObject({ plan: 'business', status: 'active', priceMinorUnits: 9900, maxProducts: -1 });
      expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'subscription_changed' }));
    });
  });

  describe('cancel', () => {
    it('refuses to cancel an already-cancelled subscription', async () => {
      subRepo.findOne.mockResolvedValue({ id: 'sub-1', storeId: 's1', status: 'cancelled' });
      await expect(service.cancel('s1')).rejects.toBeInstanceOf(BadRequestException);
    });
    it('marks the subscription cancelled and stamps cancelledAt', async () => {
      subRepo.findOne.mockResolvedValue({ id: 'sub-1', storeId: 's1', status: 'active', plan: 'business', currentPeriodEnd: future() });
      const saved = await service.cancel('s1');
      expect(saved.status).toBe('cancelled');
      expect(saved.cancelledAt).toBeInstanceOf(Date);
    });
  });

  describe('enforceProductLimit', () => {
    const activeSub = (over: object) => ({ id: 'sub-1', storeId: 's1', status: 'active', currentPeriodEnd: future(), plan: 'starter', ...over });

    it('bypasses the count when products are unlimited (-1)', async () => {
      subRepo.findOne.mockResolvedValue(activeSub({ maxProducts: -1 }));
      await expect(service.enforceProductLimit('s1')).resolves.toBeUndefined();
      expect(productsRepo.count).not.toHaveBeenCalled();
    });
    it('passes when under the limit', async () => {
      subRepo.findOne.mockResolvedValue(activeSub({ maxProducts: 500 }));
      productsRepo.count.mockResolvedValue(200);
      await expect(service.enforceProductLimit('s1')).resolves.toBeUndefined();
    });
    it('throws Forbidden when at/over the limit', async () => {
      subRepo.findOne.mockResolvedValue(activeSub({ maxProducts: 500 }));
      productsRepo.count.mockResolvedValue(500);
      await expect(service.enforceProductLimit('s1')).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('enforceFeature', () => {
    it('passes when the plan includes the feature', async () => {
      subRepo.findOne.mockResolvedValue({ id: 'sub-1', storeId: 's1', status: 'active', currentPeriodEnd: future(), plan: 'business', featuresEnabled: ['ia_pricing'] });
      await expect(service.enforceFeature('s1', 'ia_pricing')).resolves.toBeUndefined();
    });
    it('throws Forbidden when the feature is not in the plan', async () => {
      subRepo.findOne.mockResolvedValue({ id: 'sub-1', storeId: 's1', status: 'active', currentPeriodEnd: future(), plan: 'starter', featuresEnabled: ['pos_basic'] });
      await expect(service.enforceFeature('s1', 'ia_pricing')).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('getByStoreId', () => {
    it('throws NotFound when the store has no subscription', async () => {
      subRepo.findOne.mockResolvedValue(null);
      await expect(service.getByStoreId('s1')).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
