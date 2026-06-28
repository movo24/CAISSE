import { Injectable, BadRequestException } from '@nestjs/common';
import { createHmac, randomBytes } from 'crypto';
import {
  tokenExpiresAt,
  isTokenExpired,
  constantTimeEqual,
  hasRequiredClaims,
} from './qr-token';

export interface LoyaltyTokenPayload {
  customerId: string;
  cardId: string;
  expiresAt: number; // unix ms
}

/**
 * QR token format (base64url):
 *   base64url(JSON_PAYLOAD).base64url(HMAC_SHA256(secret, JSON_PAYLOAD))
 *
 * The token contains NO personal data, only IDs and expiration.
 * Server validates HMAC + expiration before resolving customer.
 *
 * TTL: 60 seconds. The mobile app rotates the token automatically.
 */
@Injectable()
export class LoyaltyTokenService {
  /**
   * Generate a fresh QR token for a card.
   * Returns the token string + the expiration timestamp.
   */
  generate(
    customerId: string,
    cardId: string,
    cardSecret: string,
  ): { token: string; expiresAt: Date } {
    const expiresAt = tokenExpiresAt(Date.now());
    const payload: LoyaltyTokenPayload = {
      customerId,
      cardId,
      expiresAt,
    };

    const payloadStr = JSON.stringify(payload);
    const payloadB64 = Buffer.from(payloadStr).toString('base64url');
    const sig = createHmac('sha256', cardSecret)
      .update(payloadStr)
      .digest('base64url');

    return {
      token: `${payloadB64}.${sig}`,
      expiresAt: new Date(expiresAt),
    };
  }

  /**
   * Verify a QR token and return the payload.
   * Throws BadRequestException on any failure (no leak which check failed).
   */
  verify(token: string, cardSecret: string): LoyaltyTokenPayload {
    if (!token || typeof token !== 'string') {
      throw new BadRequestException('QR invalide');
    }

    const parts = token.split('.');
    if (parts.length !== 2) {
      throw new BadRequestException('QR invalide');
    }

    const [payloadB64, providedSig] = parts;

    let payloadStr: string;
    let payload: LoyaltyTokenPayload;
    try {
      payloadStr = Buffer.from(payloadB64, 'base64url').toString('utf8');
      payload = JSON.parse(payloadStr);
    } catch {
      throw new BadRequestException('QR invalide');
    }

    const expectedSig = createHmac('sha256', cardSecret)
      .update(payloadStr)
      .digest('base64url');

    // Constant-time comparison to prevent timing attacks
    if (!constantTimeEqual(providedSig, expectedSig)) {
      throw new BadRequestException('QR invalide');
    }

    if (isTokenExpired(payload.expiresAt)) {
      throw new BadRequestException('QR expiré — affichez à nouveau votre carte');
    }

    if (!hasRequiredClaims(payload)) {
      throw new BadRequestException('QR invalide');
    }

    return payload;
  }

  /**
   * Generate a fresh per-card secret. Stored raw in DB; used as HMAC key.
   * Per-card scope means a leak of one secret does not affect other cards.
   * Rotated on demand via /mobile/loyalty-card/regenerate-qr.
   */
  generateCardSecret(): string {
    return randomBytes(32).toString('base64url');
  }
}
