import {
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PromoRuleEntity } from '../../database/entities/promo-rule.entity';

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
            const groupSize = promo.buyQuantity + 1;
            const discountedItems = Math.floor(item.quantity / groupSize);
            if (discountedItems > 0) {
              const discountPerItem = Math.round(
                item.unitPriceMinorUnits * (promo.discountPercent / 100),
              );
              results.push({
                promoId: promo.id,
                promoName: promo.name,
                productId: item.productId,
                discountMinorUnits: discountPerItem * discountedItems,
                type: promo.type,
              });
            }
            break;
          }
          case 'percentage': {
            if (!promo.discountPercent) break;
            const lineTotal = item.unitPriceMinorUnits * item.quantity;
            const discount = Math.round(
              lineTotal * (promo.discountPercent / 100),
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
            const lineTotal = item.unitPriceMinorUnits * item.quantity;
            const discount = Math.round(lineTotal * 0.05); // 5%
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

    return results;
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
