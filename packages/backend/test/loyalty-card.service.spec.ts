/**
 * LoyaltyCardService — card lifecycle + QR resolution (POS scan).
 *
 * Covered (EXECUTE-class, deterministic):
 *  - createCard: idempotent (one card per customer, returns existing on repeat).
 *  - getCardView: NotFound when absent, Forbidden when not ACTIVE, fresh QR token
 *    bound to the card secret when ACTIVE.
 *  - rotateQr: NotFound when absent, changes the secret + invalidates old tokens.
 *  - suspend: flips status/reason; no-op (0 rows) when customer unknown.
 *  - resolveToken: rejects malformed token, unknown card, non-ACTIVE card,
 *    wrong-secret HMAC; resolves a valid token to the card.
 *
 * The real LoyaltyTokenService is used (pure HMAC/crypto, no network) so the QR
 * generate→resolve round-trip is exercised for real.
 */
import './helpers/env-setup';
import { DataSource } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import {
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { createPgMemDataSource } from './helpers/pgmem';
import { LoyaltyCardEntity } from '../src/database/entities/loyalty-card.entity';
import { CouponEntity } from '../src/database/entities/coupon.entity';
import { LoyaltyCardService } from '../src/modules/loyalty-card/loyalty-card.service';
import { LoyaltyTokenService } from '../src/modules/loyalty-card/loyalty-token.service';

describe('LoyaltyCardService', () => {
  let ds: DataSource;
  let cardRepo: ReturnType<DataSource['getRepository']>;
  let couponRepo: ReturnType<DataSource['getRepository']>;
  let tokenService: LoyaltyTokenService;
  let svc: LoyaltyCardService;

  beforeAll(async () => {
    const { dataSource } = createPgMemDataSource();
    ds = dataSource.isInitialized ? dataSource : await dataSource.initialize();
    cardRepo = ds.getRepository(LoyaltyCardEntity);
    couponRepo = ds.getRepository(CouponEntity);
  });

  afterAll(async () => {
    await ds?.destroy();
  });

  beforeEach(async () => {
    await ds.query('DELETE FROM loyalty_cards');
    await ds.query('DELETE FROM coupons');
    tokenService = new LoyaltyTokenService();
    svc = new LoyaltyCardService(
      cardRepo as any,
      couponRepo as any,
      tokenService,
    );
  });

  describe('createCard', () => {
    it('creates an ACTIVE card with a WES- public code and a stored secret', async () => {
      const customerId = uuidv4();
      const card = await svc.createCard(customerId);

      expect(card.id).toBeDefined();
      expect(card.customerId).toBe(customerId);
      expect(card.status).toBe('ACTIVE');
      expect(card.publicCode).toMatch(/^WES-[A-Z0-9]{9}$/);
      expect(typeof card.qrSecret).toBe('string');
      expect(card.qrSecret.length).toBeGreaterThan(0);

      const persisted = await cardRepo.findOne({ where: { customerId } });
      expect(persisted).not.toBeNull();
    });

    it('is idempotent — second call returns the existing card, no duplicate row', async () => {
      const customerId = uuidv4();
      const first = await svc.createCard(customerId);
      const second = await svc.createCard(customerId);

      expect(second.id).toBe(first.id);
      expect(second.qrSecret).toBe(first.qrSecret);

      const count = await cardRepo.count({ where: { customerId } });
      expect(count).toBe(1);
    });
  });

  describe('getCardView', () => {
    it('throws NotFound when the customer has no card', async () => {
      await expect(svc.getCardView(uuidv4())).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('throws Forbidden when the card is not ACTIVE', async () => {
      const customerId = uuidv4();
      await svc.createCard(customerId);
      await cardRepo.update({ customerId }, { status: 'SUSPENDED' });

      await expect(svc.getCardView(customerId)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('returns the card view with a fresh QR token that resolves back to the card', async () => {
      const customerId = uuidv4();
      const card = await svc.createCard(customerId);

      const view = await svc.getCardView(customerId);

      expect(view.publicCode).toBe(card.publicCode);
      expect(view.status).toBe('ACTIVE');
      expect(typeof view.qrToken).toBe('string');
      expect(view.qrToken.split('.').length).toBe(2);
      expect(new Date(view.qrTokenExpiresAt).getTime()).toBeGreaterThan(
        Date.now(),
      );
      expect(typeof view.issuedAt).toBe('string');

      // The emitted token must verify against this card's secret (real HMAC).
      const payload = tokenService.verify(view.qrToken, card.qrSecret);
      expect(payload.cardId).toBe(card.id);
      expect(payload.customerId).toBe(customerId);
    });
  });

  describe('rotateQr', () => {
    it('throws NotFound when the customer has no card', async () => {
      await expect(svc.rotateQr(uuidv4())).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('rotates the secret, invalidating previously issued tokens', async () => {
      const customerId = uuidv4();
      const card = await svc.createCard(customerId);
      const oldSecret = card.qrSecret;

      // Token minted under the OLD secret.
      const { token: oldToken } = tokenService.generate(
        customerId,
        card.id,
        oldSecret,
      );

      const view = await svc.rotateQr(customerId);

      const rotated = await cardRepo.findOne({ where: { customerId } });
      expect(rotated!.qrSecret).not.toBe(oldSecret);
      expect(rotated!.rotatedAt).not.toBeNull();

      // The new view's token verifies under the NEW secret...
      const fresh = tokenService.verify(view.qrToken, rotated!.qrSecret);
      expect(fresh.cardId).toBe(card.id);

      // ...and the OLD token no longer resolves: card is still ACTIVE so we
      // reach the HMAC check, which fails under the new secret (BadRequest).
      await expect(svc.resolveToken(oldToken)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });
  });

  describe('suspend', () => {
    it('sets status SUSPENDED with reason + suspendedAt', async () => {
      const customerId = uuidv4();
      await svc.createCard(customerId);

      await svc.suspend(customerId, 'fraude détectée');

      const card = await cardRepo.findOne({ where: { customerId } });
      expect(card!.status).toBe('SUSPENDED');
      expect(card!.suspendedReason).toBe('fraude détectée');
      expect(card!.suspendedAt).not.toBeNull();
    });

    it('is a no-op for an unknown customer (no row created)', async () => {
      await svc.suspend(uuidv4(), 'whatever');
      const count = await cardRepo.count();
      expect(count).toBe(0);
    });
  });

  describe('resolveToken (POS scan)', () => {
    it('rejects a structurally malformed token (undecodable payload)', async () => {
      await expect(svc.resolveToken('not-a-valid-token')).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('rejects when the embedded cardId does not exist', async () => {
      // Build a payload referencing a random, non-existent card id.
      const payload = JSON.stringify({
        customerId: uuidv4(),
        cardId: uuidv4(),
        expiresAt: Date.now() + 60_000,
      });
      const payloadB64 = Buffer.from(payload).toString('base64url');
      const token = `${payloadB64}.deadbeef`;

      await expect(svc.resolveToken(token)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('rejects a valid token for a non-ACTIVE card', async () => {
      const customerId = uuidv4();
      const card = await svc.createCard(customerId);
      const { token } = tokenService.generate(
        customerId,
        card.id,
        card.qrSecret,
      );
      await cardRepo.update({ customerId }, { status: 'REVOKED' });

      await expect(svc.resolveToken(token)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('rejects a token signed with the wrong secret (HMAC mismatch)', async () => {
      const customerId = uuidv4();
      const card = await svc.createCard(customerId);
      // Sign the correct payload (right cardId) with a forged secret.
      const { token } = tokenService.generate(
        customerId,
        card.id,
        'attacker-controlled-secret',
      );

      await expect(svc.resolveToken(token)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('resolves a freshly generated valid token to its card', async () => {
      const customerId = uuidv4();
      const card = await svc.createCard(customerId);
      const { token } = tokenService.generate(
        customerId,
        card.id,
        card.qrSecret,
      );

      const resolved = await svc.resolveToken(token);
      expect(resolved.id).toBe(card.id);
      expect(resolved.customerId).toBe(customerId);
      expect(resolved.status).toBe('ACTIVE');
    });
  });
});
