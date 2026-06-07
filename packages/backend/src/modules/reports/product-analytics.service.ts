import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SaleEntity } from '../../database/entities/sale.entity';
import { SaleLineItemEntity } from '../../database/entities/sale-line-item.entity';
import { ProductEntity } from '../../database/entities/product.entity';
import {
  computeProductAnalytics,
  ProductSalesRow,
  ProductAnalyticsReport,
} from './product-analytics.util';

/**
 * ProductAnalyticsService — agrège les ventes FIGÉES (lecture seule) en signaux
 * d'aide à la décision (top/flop/dormant/réassort). Aucun recalcul fiscal,
 * aucune écriture. Toute la logique de classification vit dans le .util (testé).
 */
@Injectable()
export class ProductAnalyticsService {
  constructor(
    @InjectRepository(SaleEntity) private readonly saleRepo: Repository<SaleEntity>,
    @InjectRepository(SaleLineItemEntity) private readonly lineRepo: Repository<SaleLineItemEntity>,
    @InjectRepository(ProductEntity) private readonly productRepo: Repository<ProductEntity>,
  ) {}

  /** Somme des unités vendues par produit sur [from, to) (ventes complétées). */
  private async unitsByProduct(storeId: string, from: Date, to: Date): Promise<Map<string, number>> {
    const rows = await this.lineRepo
      .createQueryBuilder('li')
      .innerJoin(SaleEntity, 's', 's.id = li.sale_id')
      .select('li.product_id', 'productId')
      .addSelect('SUM(li.quantity)', 'units')
      .where('s.store_id = :storeId', { storeId })
      .andWhere("s.status = 'completed'")
      .andWhere('s.created_at >= :from', { from })
      .andWhere('s.created_at < :to', { to })
      .andWhere('li.product_id IS NOT NULL')
      .groupBy('li.product_id')
      .getRawMany<{ productId: string; units: string }>();
    return new Map(rows.map((r) => [r.productId, Number(r.units) || 0]));
  }

  /** Dernière vente par produit (toutes périodes). */
  private async lastSoldByProduct(storeId: string): Promise<Map<string, string>> {
    const rows = await this.lineRepo
      .createQueryBuilder('li')
      .innerJoin(SaleEntity, 's', 's.id = li.sale_id')
      .select('li.product_id', 'productId')
      .addSelect('MAX(s.created_at)', 'lastSoldAt')
      .where('s.store_id = :storeId', { storeId })
      .andWhere("s.status = 'completed'")
      .andWhere('li.product_id IS NOT NULL')
      .groupBy('li.product_id')
      .getRawMany<{ productId: string; lastSoldAt: string | Date }>();
    return new Map(
      rows.map((r) => [r.productId, new Date(r.lastSoldAt).toISOString()]),
    );
  }

  async getReport(storeId: string, now: Date = new Date()): Promise<ProductAnalyticsReport> {
    const d = (days: number) => new Date(now.getTime() - days * 86_400_000);
    const [u7, u30, uPrev30, lastSold, products] = await Promise.all([
      this.unitsByProduct(storeId, d(7), now),
      this.unitsByProduct(storeId, d(30), now),
      this.unitsByProduct(storeId, d(60), d(30)),
      this.lastSoldByProduct(storeId),
      this.productRepo.find({ where: { storeId } }),
    ]);

    const rows: ProductSalesRow[] = products.map((p) => ({
      productId: p.id,
      name: p.name,
      ean: p.ean,
      stockQuantity: p.stockQuantity,
      priceMinorUnits: p.priceMinorUnits,
      isActive: p.isActive,
      unitsSold7d: u7.get(p.id) ?? 0,
      unitsSold30d: u30.get(p.id) ?? 0,
      unitsSoldPrev30d: uPrev30.get(p.id) ?? 0,
      lastSoldAt: lastSold.get(p.id) ?? null,
    }));

    return computeProductAnalytics(rows, { now: now.toISOString() });
  }
}
