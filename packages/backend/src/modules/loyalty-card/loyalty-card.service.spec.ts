import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NotFoundException, ForbiddenException } from '@nestjs/common';

import { LoyaltyCardService } from './loyalty-card.service';
import { LoyaltyCardEntity } from '../../database/entities/loyalty-card.entity';
import { CouponEntity } from '../../database/entities/coupon.entity';
import { LoyaltyTokenService } from './loyalty-token.service';

// PAQUET 257 — loyalty card service. DI-mocked. Locks: idempotent createCard,
// active-status gate on views, QR rotation, suspend, and QR token resolution
// (malformed / unknown / inactive → 403).

const b64url = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');

describe('LoyaltyCardService', () => {
  let service: LoyaltyCardService;
  let cardRepo: { findOne: jest.Mock; create: jest.Mock; save: jest.Mock; update: jest.Mock };
  let token: { generateCardSecret: jest.Mock; generate: jest.Mock; verify: jest.Mock };

  beforeEach(async () => {
    cardRepo = {
      findOne: jest.fn(),
      create: jest.fn((x) => x),
      save: jest.fn((x) => Promise.resolve({ id: 'card-1', ...x })),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    token = {
      generateCardSecret: jest.fn().mockReturnValue('secret-xyz'),
      generate: jest.fn().mockReturnValue({ token: 'tok.sig', expiresAt: new Date('2026-06-07T10:05:00Z') }),
      verify: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LoyaltyCardService,
        { provide: getRepositoryToken(LoyaltyCardEntity), useValue: cardRepo },
        { provide: getRepositoryToken(CouponEntity), useValue: {} },
        { provide: LoyaltyTokenService, useValue: token },
      ],
    }).compile();

    service = module.get(LoyaltyCardService);
  });

  describe('createCard', () => {
    it('is idempotent: returns the existing card without creating a new one', async () => {
      cardRepo.findOne.mockResolvedValue({ id: 'existing' });
      const res = await service.createCard('cust-1');
      expect(res).toEqual({ id: 'existing' });
      expect(cardRepo.save).not.toHaveBeenCalled();
    });

    it('creates an ACTIVE card with a WES- public code and a fresh secret', async () => {
      cardRepo.findOne.mockResolvedValue(null);
      const res = await service.createCard('cust-1');
      expect(res.status).toBe('ACTIVE');
      expect(res.publicCode).toMatch(/^WES-[A-Z0-9]{9}$/);
      expect(res.qrSecret).toBe('secret-xyz');
    });
  });

  describe('getCardView', () => {
    it('throws NotFound when the customer has no card', async () => {
      cardRepo.findOne.mockResolvedValue(null);
      await expect(service.getCardView('cust-1')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('throws Forbidden when the card is not active', async () => {
      cardRepo.findOne.mockResolvedValue({ id: 'c', status: 'SUSPENDED', qrSecret: 's', issuedAt: new Date() });
      await expect(service.getCardView('cust-1')).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('returns a fresh QR token view for an active card', async () => {
      cardRepo.findOne.mockResolvedValue({
        id: 'c', status: 'ACTIVE', qrSecret: 's', publicCode: 'WES-ABCDEFGHJ',
        issuedAt: new Date('2026-01-01T00:00:00Z'),
      });
      const view = await service.getCardView('cust-1');
      expect(view).toMatchObject({ publicCode: 'WES-ABCDEFGHJ', status: 'ACTIVE', qrToken: 'tok.sig' });
      expect(token.generate).toHaveBeenCalledWith('cust-1', 'c', 's');
    });
  });

  describe('rotateQr', () => {
    it('throws NotFound when there is no card', async () => {
      cardRepo.findOne.mockResolvedValue(null);
      await expect(service.rotateQr('cust-1')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('rotates the secret and returns a fresh view', async () => {
      const card = { id: 'c', status: 'ACTIVE', qrSecret: 'old', publicCode: 'WES-ABCDEFGHJ', issuedAt: new Date() };
      cardRepo.findOne.mockResolvedValue(card);
      await service.rotateQr('cust-1');
      expect(card.qrSecret).toBe('secret-xyz');
      expect(cardRepo.save).toHaveBeenCalled();
    });
  });

  describe('suspend', () => {
    it('sets status SUSPENDED with a reason', async () => {
      await service.suspend('cust-1', 'fraud');
      expect(cardRepo.update).toHaveBeenCalledWith(
        { customerId: 'cust-1' },
        expect.objectContaining({ status: 'SUSPENDED', suspendedReason: 'fraud' }),
      );
    });
  });

  describe('resolveToken', () => {
    it('rejects a malformed token (403)', async () => {
      await expect(service.resolveToken('%%%not-base64%%%')).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('rejects when the card is unknown (403)', async () => {
      cardRepo.findOne.mockResolvedValue(null);
      const tok = `${b64url({ cardId: 'c1' })}.sig`;
      await expect(service.resolveToken(tok)).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('rejects an inactive card (403)', async () => {
      cardRepo.findOne.mockResolvedValue({ id: 'c1', status: 'SUSPENDED', qrSecret: 's' });
      const tok = `${b64url({ cardId: 'c1' })}.sig`;
      await expect(service.resolveToken(tok)).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('resolves an active card after HMAC verification', async () => {
      const card = { id: 'c1', status: 'ACTIVE', qrSecret: 's' };
      cardRepo.findOne.mockResolvedValue(card);
      const tok = `${b64url({ cardId: 'c1' })}.sig`;
      await expect(service.resolveToken(tok)).resolves.toBe(card);
      expect(token.verify).toHaveBeenCalledWith(tok, 's');
    });
  });
});
