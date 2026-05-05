import {
  Injectable,
  ConflictException,
  UnauthorizedException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull } from 'typeorm';
import * as bcrypt from 'bcrypt';
import * as jwt from 'jsonwebtoken';
import { CustomerEntity } from '../../database/entities/customer.entity';
import { LoyaltyCardService } from '../loyalty-card/loyalty-card.service';
import { CouponService } from '../coupon/coupon.service';

const ACCESS_TOKEN_TTL = '15m';
const REFRESH_TOKEN_TTL = '30d';

@Injectable()
export class MobileAuthService {
  constructor(
    @InjectRepository(CustomerEntity)
    private readonly customerRepo: Repository<CustomerEntity>,
    private readonly loyaltyCardService: LoyaltyCardService,
    private readonly couponService: CouponService,
  ) {}

  async register(input: {
    email: string;
    password: string;
    firstName?: string;
    preferredStoreId?: string;
  }) {
    const email = input.email.toLowerCase().trim();
    if (!email.includes('@')) {
      throw new BadRequestException('Email invalide');
    }
    if (!input.password || input.password.length < 8) {
      throw new BadRequestException('Mot de passe : 8 caractères minimum');
    }

    const existing = await this.customerRepo.findOne({
      where: { email, deletedAt: IsNull() } as any,
    });
    if (existing) {
      throw new ConflictException('Un compte existe déjà avec cet email');
    }

    const passwordHash = await bcrypt.hash(input.password, 10);

    // Generate placeholder qrCode (the loyalty card overrides this with a real token system)
    const qrCode = `legacy-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

    const customer = this.customerRepo.create({
      firstName: input.firstName || 'Wesley',
      lastName: '',
      email,
      qrCode,
      passwordHash,
      storeId: input.preferredStoreId ?? null,
      preferredStoreId: input.preferredStoreId ?? null,
      loyaltyPoints: 0,
      isFirstPurchase: true,
      isVerified: false,
    });
    const saved = await this.customerRepo.save(customer);

    // Create loyalty card + welcome coupon
    await this.loyaltyCardService.createCard(saved.id);
    await this.couponService.issueWelcome(saved.id);

    return this.buildAuthResponse(saved);
  }

  async login(email: string, password: string) {
    const customer = await this.customerRepo.findOne({
      where: { email: email.toLowerCase().trim(), deletedAt: IsNull() } as any,
    });
    if (!customer || !customer.passwordHash) {
      throw new UnauthorizedException('Identifiants invalides');
    }
    const ok = await bcrypt.compare(password, customer.passwordHash);
    if (!ok) {
      throw new UnauthorizedException('Identifiants invalides');
    }
    return this.buildAuthResponse(customer);
  }

  async refresh(refreshToken: string) {
    const secret = process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET!;
    try {
      const payload = jwt.verify(refreshToken, secret, {
        audience: 'mobile-app',
      }) as { sub: string };

      const customer = await this.customerRepo.findOne({
        where: { id: payload.sub, deletedAt: IsNull() } as any,
      });
      if (!customer) throw new UnauthorizedException();

      return this.buildAuthResponse(customer);
    } catch {
      throw new UnauthorizedException('Refresh token invalide');
    }
  }

  async getMe(customerId: string) {
    const c = await this.customerRepo.findOne({
      where: { id: customerId, deletedAt: IsNull() } as any,
    });
    if (!c) throw new UnauthorizedException();
    return {
      id: c.id,
      email: c.email,
      firstName: c.firstName,
      preferredStoreId: c.preferredStoreId,
      visitCount: c.visitCount,
      lastVisitAt: c.lastVisitAt?.toISOString() ?? null,
      createdAt: c.createdAt.toISOString(),
    };
  }

  async updateMe(
    customerId: string,
    input: { firstName?: string; preferredStoreId?: string },
  ) {
    await this.customerRepo.update(
      { id: customerId },
      {
        ...(input.firstName !== undefined && { firstName: input.firstName }),
        ...(input.preferredStoreId !== undefined && {
          preferredStoreId: input.preferredStoreId,
        }),
      },
    );
    return this.getMe(customerId);
  }

  /** Soft-delete (RGPD). The anonymization cron will scrub PII after 30 days. */
  async deleteMe(customerId: string) {
    await this.customerRepo.update(
      { id: customerId },
      { deletedAt: new Date() },
    );
    return { success: true };
  }

  private buildAuthResponse(customer: CustomerEntity) {
    const accessSecret = process.env.JWT_SECRET!;
    const refreshSecret = process.env.JWT_REFRESH_SECRET || accessSecret;

    const accessToken = jwt.sign(
      { sub: customer.id, email: customer.email, aud: 'mobile-app' },
      accessSecret,
      { expiresIn: ACCESS_TOKEN_TTL, audience: 'mobile-app' },
    );
    const refreshToken = jwt.sign(
      { sub: customer.id, aud: 'mobile-app' },
      refreshSecret,
      { expiresIn: REFRESH_TOKEN_TTL, audience: 'mobile-app' },
    );

    return {
      accessToken,
      refreshToken,
      customer: {
        id: customer.id,
        email: customer.email,
        firstName: customer.firstName,
      },
    };
  }
}
