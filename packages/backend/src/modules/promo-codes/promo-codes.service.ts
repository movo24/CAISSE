import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { PromoCodeEntity } from '../../database/entities/promo-code.entity';
import { PromoCodeRedemptionEntity } from '../../database/entities/promo-code-redemption.entity';
import { AuditService } from '../audit/audit.service';

export interface PromoValidation {
  valid: boolean;
  reason?: string;
  discountType?: 'percentage' | 'fixed';
  discountValue?: number;
  promoCodeId?: string;
}

/**
 * PromoCodes (decision 6) — shared, human-readable promo codes. Owner-defined;
 * validate() checks active/window/cap/scope; redeem() enforces the usage cap
 * RACE-SAFELY (a conditional UPDATE), logs the usage, and audits the applier.
 */
@Injectable()
export class PromoCodesService {
  constructor(
    @InjectRepository(PromoCodeEntity) private readonly codes: Repository<PromoCodeEntity>,
    @InjectRepository(PromoCodeRedemptionEntity) private readonly redemptions: Repository<PromoCodeRedemptionEntity>,
    private readonly dataSource: DataSource,
    private readonly audit: AuditService,
  ) {}

  async create(
    storeId: string,
    dto: {
      code: string;
      discountType: 'percentage' | 'fixed';
      discountValue: number;
      startsAt?: Date | null;
      endsAt?: Date | null;
      maxUses?: number | null;
      productId?: string | null;
      categoryId?: string | null;
    },
  ): Promise<PromoCodeEntity> {
    const code = (dto.code ?? '').trim().toUpperCase();
    if (!code) throw new BadRequestException('code is required');
    if (!['percentage', 'fixed'].includes(dto.discountType)) throw new BadRequestException('discountType must be percentage|fixed');
    if (!Number.isInteger(dto.discountValue) || dto.discountValue <= 0) throw new BadRequestException('discountValue must be a positive integer');
    if (dto.discountType === 'percentage' && dto.discountValue > 100) throw new BadRequestException('percentage cannot exceed 100');
    if (await this.codes.findOne({ where: { storeId, code } })) throw new BadRequestException(`Code already exists: ${code}`);

    return this.codes.save(
      this.codes.create({
        storeId,
        code,
        discountType: dto.discountType,
        discountValue: dto.discountValue,
        startsAt: dto.startsAt ?? null,
        endsAt: dto.endsAt ?? null,
        maxUses: dto.maxUses ?? null,
        productId: dto.productId ?? null,
        categoryId: dto.categoryId ?? null,
        isActive: true,
      }),
    );
  }

  list(storeId: string): Promise<PromoCodeEntity[]> {
    return this.codes.find({ where: { storeId }, order: { createdAt: 'DESC' } });
  }

  async deactivate(id: string, storeId: string): Promise<PromoCodeEntity> {
    const code = await this.codes.findOne({ where: { id, storeId } });
    if (!code) throw new NotFoundException('Promo code not found');
    code.isActive = false;
    return this.codes.save(code);
  }

  /** Validate a code for a context (no state change). */
  async validate(
    rawCode: string,
    storeId: string,
    ctx: { productId?: string; categoryId?: string } = {},
    now: Date = new Date(),
  ): Promise<PromoValidation> {
    const code = (rawCode ?? '').trim().toUpperCase();
    const promo = await this.codes.findOne({ where: { storeId, code } });
    if (!promo) return { valid: false, reason: 'code introuvable' };
    if (!promo.isActive) return { valid: false, reason: 'code inactif' };
    if (promo.startsAt && now < new Date(promo.startsAt)) return { valid: false, reason: 'code pas encore actif' };
    if (promo.endsAt && now > new Date(promo.endsAt)) return { valid: false, reason: 'code expiré' };
    if (promo.maxUses != null && promo.usedCount >= promo.maxUses) return { valid: false, reason: 'limite d’utilisation atteinte' };
    if (promo.productId && promo.productId !== ctx.productId) return { valid: false, reason: 'code non applicable à ce produit' };
    if (promo.categoryId && promo.categoryId !== ctx.categoryId) return { valid: false, reason: 'code non applicable à cette catégorie' };
    return { valid: true, discountType: promo.discountType, discountValue: promo.discountValue, promoCodeId: promo.id };
  }

  /**
   * Redeem a code: enforce the usage cap race-safely (conditional UPDATE), log
   * the usage and audit the applier. Returns the validated discount.
   */
  async redeem(
    rawCode: string,
    storeId: string,
    employeeId: string,
    opts: { saleId?: string; discountAppliedMinorUnits?: number; productId?: string; categoryId?: string } = {},
  ): Promise<PromoValidation & { redeemed: true }> {
    const v = await this.validate(rawCode, storeId, { productId: opts.productId, categoryId: opts.categoryId });
    if (!v.valid) throw new BadRequestException(v.reason ?? 'code invalide');

    // Race-safe cap: increment only while under the limit; 0 rows → cap hit.
    const res = await this.dataSource.query(
      `UPDATE promo_codes SET used_count = used_count + 1, updated_at = now()
       WHERE id = $1 AND store_id = $2 AND is_active = true
         AND (max_uses IS NULL OR used_count < max_uses)
       RETURNING used_count`,
      [v.promoCodeId, storeId],
    );
    if (!Array.isArray(res) || res.length === 0) {
      throw new BadRequestException('limite d’utilisation atteinte');
    }

    await this.redemptions.save(
      this.redemptions.create({
        promoCodeId: v.promoCodeId!,
        storeId,
        employeeId,
        saleId: opts.saleId ?? null,
        discountAppliedMinorUnits: opts.discountAppliedMinorUnits ?? null,
      }),
    );
    await this.audit.log({
      storeId,
      employeeId,
      action: 'promo_code_applied',
      entityType: 'promo_code',
      entityId: v.promoCodeId!,
      details: { code: (rawCode ?? '').trim().toUpperCase(), saleId: opts.saleId ?? null, discount: opts.discountAppliedMinorUnits ?? null },
    });
    return { ...v, redeemed: true };
  }

  /**
   * Reserve one use of a code INSIDE an existing transaction (the sale tx). The
   * cap is enforced race-safely by the same conditional UPDATE as redeem(); 0 rows
   * → cap hit → throw, which rolls back the whole sale (no over-redemption, and no
   * sale committed with a discount it wasn't entitled to). Logs the redemption in
   * the same tx. Audit is left to the caller (post-commit history).
   */
  async reserveAtSale(
    manager: EntityManager,
    args: { promoCodeId: string; storeId: string; employeeId: string; saleId: string; discountAppliedMinorUnits: number },
  ): Promise<void> {
    const res = await manager.query(
      `UPDATE promo_codes SET used_count = used_count + 1, updated_at = now()
       WHERE id = $1 AND store_id = $2 AND is_active = true
         AND (max_uses IS NULL OR used_count < max_uses)
       RETURNING used_count`,
      [args.promoCodeId, args.storeId],
    );
    if (!Array.isArray(res) || res.length === 0) {
      throw new BadRequestException('Code promo : limite d’utilisation atteinte');
    }
    await manager.getRepository(PromoCodeRedemptionEntity).insert({
      promoCodeId: args.promoCodeId,
      storeId: args.storeId,
      employeeId: args.employeeId,
      saleId: args.saleId,
      discountAppliedMinorUnits: args.discountAppliedMinorUnits,
    });
  }

  /** Usage history for a code. */
  history(promoCodeId: string, storeId: string): Promise<PromoCodeRedemptionEntity[]> {
    return this.redemptions.find({ where: { promoCodeId, storeId }, order: { appliedAt: 'DESC' } });
  }
}
