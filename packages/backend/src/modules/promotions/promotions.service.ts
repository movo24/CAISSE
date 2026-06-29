import {
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PromoRuleEntity } from '../../database/entities/promo-rule.entity';
import { dedupeBestPerProduct } from './promo-policy';
import {
  buyXGetDiscount,
  percentageDiscount,
  firstPurchaseDiscount,
  lineTotal,
} from './promo-discount';

export interface CartItem {
  productId: string;
  categoryId?: string;
  quantity: number;
  unitPriceMinorUnits: number;
}

export interface PromoResult {
  promoId: string;
  promoName: string;
  productId: string;
  discountMinorUnits: number;
  type: string;
}

@Injectable()
export class PromotionsService {
  constructor(
    @InjectRepository(PromoRuleEntity)
    private promoRepo: Repository<PromoRuleEntity>,
  ) {}

  async create(data: Partial<PromoRuleEntity>): Promise<PromoRuleEntity> {
    const promo = this.promoRepo.create(data);
    return this.promoRepo.save(promo);
  }

  async findAll(storeId: string): Promise<PromoRuleEntity[]> {
    return this.promoRepo.find({ where: { storeId, isActive: true } });
  }

  async findOne(id: string, storeId?: string): Promise<PromoRuleEntity> {
    const where: any = { id };
    if (storeId) where.storeId = storeId;
    const promo = await this.promoRepo.findOne({ where });
    if (!promo) throw new NotFoundException('Promo not found');
    return promo;
  }

  /** Tenant-safe: throws if promo does not belong to store */
  async findOneForStore(
    id: string,
    storeId: string,
  ): Promise<PromoRuleEntity> {
    const promo = await this.promoRepo.findOne({
      where: { id, storeId },
    });
    if (!promo) {
      throw new ForbiddenException(
        'Promo not found or belongs to another store.',
      );
    }
    return promo;
  }

  async update(
    id: string,
    data: Partial<PromoRuleEntity>,
    storeId: string,
  ): Promise<PromoRuleEntity> {
    await this.findOneForStore(id, storeId);
    await this.promoRepo.update(id, data);
    return this.findOneForStore(id, storeId);
  }

  async getActivePromos(storeId: string): Promise<PromoRuleEntity[]> {
    const now = new Date();
    return this.promoRepo
      .createQueryBuilder('p')
      .where('p.store_id = :storeId', { storeId })
      .andWhere('p.is_active = true')
      .andWhere('p.start_date <= :now', { now })
      .andWhere('(p.end_date IS NULL OR p.end_date >= :now)', { now })
      // POS-073 — exclude promos that reached their usage cap (NULL limit = unlimited).
      .andWhere('(p.usage_limit IS NULL OR p.usage_count < p.usage_limit)')
      .getMany();
  }

  /**
   * Apply promotions to a cart. Returns discount breakdown per item.
   */
  async applyPromos(
    storeId: string,
    cartItems: CartItem[],
    isFirstPurchase = false,
  ): Promise<PromoResult[]> {
    const activePromos = await this.getActivePromos(storeId);
    const results: PromoResult[] = [];

    for (const promo of activePromos) {
      if (promo.type === 'first_purchase' && !isFirstPurchase) continue;

      for (const item of cartItems) {
        const isApplicable = this.isPromoApplicable(promo, item);
        if (!isApplicable) continue;

        switch (promo.type) {
          case 'buy_x_get_discount': {
            if (!promo.buyQuantity || !promo.discountPercent) break;
            const discountTotal = buyXGetDiscount(
              item.quantity,
              promo.buyQuantity,
              item.unitPriceMinorUnits,
              promo.discountPercent,
            );
            if (discountTotal > 0) {
              results.push({
                promoId: promo.id,
                promoName: promo.name,
                productId: item.productId,
                discountMinorUnits: discountTotal,
                type: promo.type,
              });
            }
            break;
          }
          case 'percentage': {
            if (!promo.discountPercent) break;
            const discount = percentageDiscount(
              lineTotal(item.unitPriceMinorUnits, item.quantity),
              promo.discountPercent,
            );
            results.push({
              promoId: promo.id,
              promoName: promo.name,
              productId: item.productId,
              discountMinorUnits: discount,
              type: promo.type,
            });
            break;
          }
          case 'fixed_amount': {
            if (!promo.discountFixedMinorUnits) break;
            results.push({
              promoId: promo.id,
              promoName: promo.name,
              productId: item.productId,
              discountMinorUnits: promo.discountFixedMinorUnits,
              type: promo.type,
            });
            break;
          }
          case 'first_purchase': {
            const discount = firstPurchaseDiscount(
              lineTotal(item.unitPriceMinorUnits, item.quantity),
            );
            results.push({
              promoId: promo.id,
              promoName: promo.name,
              productId: item.productId,
              discountMinorUnits: discount,
              type: promo.type,
            });
            break;
          }
        }
      }
    }

    // POS-073 anti-cumul: at most one promo (the largest discount) per product.
    // Prevents two active promos from stacking on the same product downstream.
    return dedupeBestPerProduct(results);
  }

  private isPromoApplicable(promo: PromoRuleEntity, item: CartItem): boolean {
    if (
      (!promo.applicableProductIds ||
        promo.applicableProductIds.length === 0) &&
      (!promo.applicableCategoryIds ||
        promo.applicableCategoryIds.length === 0)
    ) {
      return true;
    }
    if (promo.applicableProductIds?.includes(item.productId)) return true;
    if (
      item.categoryId &&
      promo.applicableCategoryIds?.includes(item.categoryId)
    )
      return true;
    return false;
  }
}
