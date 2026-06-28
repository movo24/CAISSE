import {
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { LoyaltyCardEntity } from '../../database/entities/loyalty-card.entity';
import { CouponEntity } from '../../database/entities/coupon.entity';
import { LoyaltyTokenService } from './loyalty-token.service';
import { isCardActive } from './qr-token';

@Injectable()
export class LoyaltyCardService {
  constructor(
    @InjectRepository(LoyaltyCardEntity)
    private readonly cardRepo: Repository<LoyaltyCardEntity>,
    @InjectRepository(CouponEntity)
    private readonly couponRepo: Repository<CouponEntity>,
    private readonly tokenService: LoyaltyTokenService,
  ) {}

  /** Generate a public code like WES-AABBCC123 */
  private generatePublicCode(): string {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = 'WES-';
    for (let i = 0; i < 9; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
  }

  /** Create card for a freshly registered customer. */
  async createCard(customerId: string): Promise<LoyaltyCardEntity> {
    const existing = await this.cardRepo.findOne({ where: { customerId } });
    if (existing) return existing;

    const secret = this.tokenService.generateCardSecret();
    const card = this.cardRepo.create({
      customerId,
      publicCode: this.generatePublicCode(),
      qrSecret: secret,
      status: 'ACTIVE',
    });
    return this.cardRepo.save(card);
  }

  /** Get card view + fresh QR token for the customer dashboard. */
  async getCardView(customerId: string) {
    const card = await this.cardRepo.findOne({ where: { customerId } });
    if (!card) throw new NotFoundException('Carte fidélité introuvable');
    if (!isCardActive(card.status)) {
      throw new ForbiddenException(`Carte ${card.status.toLowerCase()}`);
    }

    const { token, expiresAt } = this.tokenService.generate(
      customerId,
      card.id,
      card.qrSecret,
    );

    return {
      publicCode: card.publicCode,
      status: card.status,
      qrToken: token,
      qrTokenExpiresAt: expiresAt.toISOString(),
      issuedAt: card.issuedAt.toISOString(),
    };
  }

  /** Rotate QR secret — invalidates all previously issued tokens. */
  async rotateQr(customerId: string) {
    const card = await this.cardRepo.findOne({ where: { customerId } });
    if (!card) throw new NotFoundException('Carte introuvable');

    card.qrSecret = this.tokenService.generateCardSecret();
    card.rotatedAt = new Date();
    await this.cardRepo.save(card);

    return this.getCardView(customerId);
  }

  /** Suspend card (admin/anti-fraud). */
  async suspend(customerId: string, reason: string): Promise<void> {
    await this.cardRepo.update(
      { customerId },
      {
        status: 'SUSPENDED',
        suspendedAt: new Date(),
        suspendedReason: reason,
      },
    );
  }

  /**
   * Resolve a QR token to its card.
   * Used by POS scan endpoint.
   */
  async resolveToken(qrToken: string): Promise<LoyaltyCardEntity> {
    // First, decode the unsigned payload to find the card (we need its secret)
    // We accept this small leak of the cardId because the HMAC verification
    // happens immediately after.
    let cardId: string;
    try {
      const payloadB64 = qrToken.split('.')[0];
      const payloadStr = Buffer.from(payloadB64, 'base64url').toString('utf8');
      cardId = JSON.parse(payloadStr).cardId;
    } catch {
      throw new ForbiddenException('QR invalide');
    }

    const card = await this.cardRepo.findOne({ where: { id: cardId } });
    if (!card) throw new ForbiddenException('Carte introuvable');
    if (!isCardActive(card.status)) {
      throw new ForbiddenException(`Carte ${card.status.toLowerCase()}`);
    }

    // Now verify HMAC with the card's secret
    this.tokenService.verify(qrToken, card.qrSecret);

    return card;
  }
}
