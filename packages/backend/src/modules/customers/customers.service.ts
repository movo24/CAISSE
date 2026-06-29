import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as QRCode from 'qrcode';
import { randomBytes } from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { CustomerEntity } from '../../database/entities/customer.entity';
import { PaginatedResult } from '../../common/dto/pagination.dto';
import {
  formatOtpCode,
  otpExpiresAt,
  isOtpExpired,
  isOtpMaxAttempts,
  otpCodeMatches,
} from './otp-policy';
import { NotificationService } from '../../common/messaging/notification.service';

@Injectable()
export class CustomersService {
  private readonly logger = new Logger(CustomersService.name);

  /**
   * In-memory OTP store: customerId -> { code, expiresAt }
   * TODO V1: Replace with Redis for multi-instance support
   */
  private readonly otpStore = new Map<
    string,
    { code: string; expiresAt: number; attempts: number }
  >();
  // OTP TTL / attempt cap live in otp-policy.ts (OTP_TTL_MS, OTP_MAX_ATTEMPTS).

  constructor(
    @InjectRepository(CustomerEntity)
    private customerRepo: Repository<CustomerEntity>,
    private readonly notifications: NotificationService,
  ) {}

  async create(data: {
    firstName: string;
    lastName: string;
    phone?: string;
    email?: string;
    storeId: string;
  }): Promise<{
    customer: CustomerEntity;
    qrCodeDataUrl: string;
    otpCode: string;
  }> {
    const qrCode = `CLI-${uuidv4().slice(0, 8).toUpperCase()}`;

    const customer = this.customerRepo.create({
      ...data,
      qrCode,
      loyaltyPoints: 0,
      isFirstPurchase: true,
      isVerified: false,
    });
    const saved = await this.customerRepo.save(customer);
    const qrCodeDataUrl = await QRCode.toDataURL(qrCode);

    // Generate crypto-safe OTP code
    const otpCode = formatOtpCode(randomBytes(4).readUInt32BE(0));

    // Store OTP with expiry
    this.otpStore.set(saved.id, {
      code: otpCode,
      expiresAt: otpExpiresAt(Date.now()),
      attempts: 0,
    });

    // Deliver the OTP via SMS (preferred) or email. Graceful: if no provider is
    // configured, this is a no-op and the dev fallback below still applies.
    await this.dispatchOtp(saved, otpCode);

    // Do NOT log OTP codes in production
    if (process.env.NODE_ENV !== 'production') {
      this.logger.debug(`[DEV OTP] Customer ${saved.firstName}: ${otpCode}`);
    }

    return { customer: saved, qrCodeDataUrl, otpCode };
  }

  /**
   * Send the loyalty verification OTP to the customer via the configured channel.
   * Never throws — delivery failure must not block customer creation.
   */
  private async dispatchOtp(customer: CustomerEntity, code: string): Promise<void> {
    if (!customer.phone && !customer.email) return;
    const body = `Votre code de vérification Wesley Club : ${code} (valable 10 min).`;
    try {
      const res = await this.notifications.notify({
        prefer: 'sms',
        sms: customer.phone ? { to: customer.phone, body } : undefined,
        email: customer.email
          ? {
              to: customer.email,
              subject: 'Votre code de vérification',
              html: `<p>Bonjour ${customer.firstName},</p><p>${body}</p>`,
            }
          : undefined,
      });
      if (res.ok) {
        this.logger.log(`[OTP] sent to customer ${customer.id.slice(0, 8)} via ${res.provider}`);
      } else if (!res.skipped) {
        this.logger.warn(`[OTP] delivery failed for ${customer.id.slice(0, 8)}: ${res.error}`);
      }
    } catch (err: any) {
      this.logger.warn(`[OTP] dispatch error for ${customer.id.slice(0, 8)}: ${err?.message}`);
    }
  }

  /** Find customer by QR code scoped to the caller's store */
  async findByQrCode(
    qrCode: string,
    storeId: string,
  ): Promise<CustomerEntity | null> {
    return this.customerRepo.findOne({ where: { qrCode, storeId } });
  }

  /**
   * Find customer by ID. Always requires storeId for tenant isolation.
   */
  async findOne(id: string, storeId: string): Promise<CustomerEntity> {
    const customer = await this.customerRepo.findOne({
      where: { id, storeId },
    });
    if (!customer) throw new NotFoundException('Customer not found');
    return customer;
  }

  /** Tenant-safe: throws if customer does not belong to store */
  async findOneForStore(
    id: string,
    storeId: string,
  ): Promise<CustomerEntity> {
    const customer = await this.customerRepo.findOne({
      where: { id, storeId },
    });
    if (!customer) {
      throw new ForbiddenException(
        'Customer not found or belongs to another store.',
      );
    }
    return customer;
  }

  async findAll(
    storeId: string,
    options?: { page?: number; limit?: number; search?: string },
  ): Promise<PaginatedResult<CustomerEntity>> {
    const page = options?.page || 1;
    const limit = options?.limit || 50;
    const skip = (page - 1) * limit;

    const qb = this.customerRepo
      .createQueryBuilder('c')
      .where('c.store_id = :storeId', { storeId });

    if (options?.search) {
      qb.andWhere(
        '(c.first_name ILIKE :search OR c.last_name ILIKE :search OR c.phone ILIKE :search OR c.email ILIKE :search)',
        { search: `%${options.search}%` },
      );
    }

    qb.orderBy('c.last_name', 'ASC').skip(skip).take(limit);

    const [data, total] = await qb.getManyAndCount();

    return {
      data,
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Verify OTP code. Validates against stored OTP with expiry and attempt limits.
   */
  async verifyOtp(
    id: string,
    otpCode: string,
    storeId: string,
  ): Promise<CustomerEntity> {
    const customer = await this.findOneForStore(id, storeId);

    if (customer.isVerified) {
      return customer; // Already verified
    }

    const stored = this.otpStore.get(id);

    // No OTP stored or expired
    if (!stored || isOtpExpired(stored.expiresAt)) {
      this.otpStore.delete(id);
      throw new BadRequestException(
        'OTP expired or not found. Please request a new verification code.',
      );
    }

    // Too many attempts
    if (isOtpMaxAttempts(stored.attempts)) {
      this.otpStore.delete(id);
      throw new BadRequestException(
        'Too many failed OTP attempts. Please request a new code.',
      );
    }

    // Wrong code
    if (!otpCodeMatches(stored.code, otpCode)) {
      stored.attempts++;
      throw new BadRequestException('Invalid OTP code.');
    }

    // Correct code — verify customer
    this.otpStore.delete(id);
    customer.isVerified = true;
    return this.customerRepo.save(customer);
  }

  /**
   * Mark first purchase as used. Requires storeId for tenant isolation.
   */
  async markFirstPurchaseUsed(id: string, storeId: string): Promise<void> {
    // Verify customer belongs to store before updating
    await this.findOneForStore(id, storeId);
    await this.customerRepo.update(id, { isFirstPurchase: false });
  }

  /**
   * Add loyalty points. Always requires storeId for tenant isolation.
   */
  async addLoyaltyPoints(
    id: string,
    points: number,
    storeId: string,
  ): Promise<CustomerEntity> {
    const customer = await this.findOneForStore(id, storeId);
    customer.loyaltyPoints += points;
    return this.customerRepo.save(customer);
  }
}
