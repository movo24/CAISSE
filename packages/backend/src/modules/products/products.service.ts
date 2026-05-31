import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ProductEntity } from '../../database/entities/product.entity';
import { PriceHistoryEntity } from '../../database/entities/price-history.entity';
import { ProductCategoryEntity } from '../../database/entities/product-category.entity';
import { AuditService } from '../audit/audit.service';
import { PaginatedResult } from '../../common/dto/pagination.dto';
import { computePriceVerdict, PriceVerdict } from './price-verdict';

@Injectable()
export class ProductsService {
  constructor(
    @InjectRepository(ProductEntity)
    private productRepo: Repository<ProductEntity>,
    @InjectRepository(PriceHistoryEntity)
    private priceHistoryRepo: Repository<PriceHistoryEntity>,
    @InjectRepository(ProductCategoryEntity)
    private categoryRepo: Repository<ProductCategoryEntity>,
    private auditService: AuditService,
  ) {}

  async create(
    data: Partial<ProductEntity>,
    employeeId: string,
  ): Promise<ProductEntity> {
    const product = this.productRepo.create(data);
    const saved = await this.productRepo.save(product);

    await this.auditService.log({
      storeId: saved.storeId,
      employeeId,
      action: 'price_change',
      entityType: 'product',
      entityId: saved.id,
      details: { action: 'created', price: saved.priceMinorUnits },
    });

    return saved;
  }

  async findAll(
    storeId: string,
    options?: { page?: number; limit?: number; search?: string },
  ): Promise<PaginatedResult<ProductEntity>> {
    const page = options?.page || 1;
    const limit = options?.limit || 50;
    const skip = (page - 1) * limit;

    const qb = this.productRepo
      .createQueryBuilder('p')
      .where('p.store_id = :storeId', { storeId })
      .andWhere('p.is_active = true');

    if (options?.search) {
      qb.andWhere(
        '(p.name ILIKE :search OR p.ean ILIKE :search)',
        { search: `%${options.search}%` },
      );
    }

    qb.orderBy('p.name', 'ASC').skip(skip).take(limit);

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

  async findByEan(
    ean: string,
    storeId: string,
  ): Promise<ProductEntity | null> {
    return this.productRepo.findOne({
      where: { ean, storeId, isActive: true },
    });
  }

  async findOne(id: string, storeId?: string): Promise<ProductEntity> {
    const where: any = { id };
    if (storeId) where.storeId = storeId;
    const product = await this.productRepo.findOne({ where });
    if (!product) throw new NotFoundException('Product not found');
    return product;
  }

  /** Tenant-safe: throws if product does not belong to store */
  async findOneForStore(
    id: string,
    storeId: string,
  ): Promise<ProductEntity> {
    const product = await this.productRepo.findOne({
      where: { id, storeId },
    });
    if (!product) {
      throw new ForbiddenException(
        'Product not found or belongs to another store.',
      );
    }
    return product;
  }

  async deactivate(id: string, storeId: string): Promise<{ message: string }> {
    const product = await this.findOneForStore(id, storeId);
    await this.productRepo.update(id, { isActive: false });
    return { message: `${product.name} supprimé du catalogue.` };
  }

  async update(
    id: string,
    data: Partial<ProductEntity>,
    employeeId: string,
    reason?: string,
    storeId?: string,
    changeSource?: string,
    employeeRole?: string,
  ): Promise<ProductEntity> {
    const existing = storeId
      ? await this.findOneForStore(id, storeId)
      : await this.findOne(id);

    // Track price changes (non-blocking: don't crash product update if history fails)
    if (
      data.priceMinorUnits !== undefined &&
      data.priceMinorUnits !== existing.priceMinorUnits
    ) {
      try {
        await this.priceHistoryRepo.save({
          productId: id,
          oldPriceMinorUnits: existing.priceMinorUnits,
          newPriceMinorUnits: data.priceMinorUnits,
          changedBy: employeeId,
          storeId: existing.storeId,
          reason: reason || 'Manual price update',
          changeSource: changeSource || 'backoffice',
          changedByRole: employeeRole || 'unknown',
        });
      } catch (historyErr: any) {
        console.warn(`[ProductsService] Price history save failed (non-blocking): ${historyErr?.message}`);
      }

      await this.auditService.log({
        storeId: existing.storeId,
        employeeId,
        action: 'price_change',
        entityType: 'product',
        entityId: id,
        details: {
          oldPrice: existing.priceMinorUnits,
          newPrice: data.priceMinorUnits,
          reason,
        },
      });
    }

    await this.productRepo.update(id, data);
    return this.findOne(id, storeId);
  }

  async updateStock(
    id: string,
    quantityDelta: number,
    storeId?: string,
  ): Promise<ProductEntity> {
    const product = storeId
      ? await this.findOneForStore(id, storeId)
      : await this.findOne(id);
    product.stockQuantity += quantityDelta;
    if (product.stockQuantity < 0) product.stockQuantity = 0;
    return this.productRepo.save(product);
  }

  async getCategories(storeId: string): Promise<{ id: string; name: string }[]> {
    return this.categoryRepo.find({
      where: { storeId },
      order: { name: 'ASC' },
      select: ['id', 'name'],
    });
  }

  async createCategory(storeId: string, name: string): Promise<ProductCategoryEntity> {
    const trimmed = name.trim();
    if (!trimmed) throw new BadRequestException('Category name is required');

    // Check for duplicates (case-insensitive)
    const existing = await this.categoryRepo
      .createQueryBuilder('c')
      .where('c.store_id = :storeId', { storeId })
      .andWhere('LOWER(c.name) = LOWER(:name)', { name: trimmed })
      .getOne();
    if (existing) return existing;

    return this.categoryRepo.save({
      name: trimmed,
      storeId,
    });
  }

  async getStockAlerts(storeId: string): Promise<{
    alert: ProductEntity[];
    critical: ProductEntity[];
  }> {
    const alert = await this.productRepo
      .createQueryBuilder('p')
      .where('p.store_id = :storeId', { storeId })
      .andWhere('p.is_active = true')
      .andWhere('p.stock_quantity <= p.stock_alert_threshold')
      .andWhere('p.stock_quantity > p.stock_critical_threshold')
      .orderBy('p.stock_quantity', 'ASC')
      .getMany();

    const critical = await this.productRepo
      .createQueryBuilder('p')
      .where('p.store_id = :storeId', { storeId })
      .andWhere('p.is_active = true')
      .andWhere('p.stock_quantity <= p.stock_critical_threshold')
      .orderBy('p.stock_quantity', 'ASC')
      .getMany();

    return { alert, critical };
  }

  async getPriceHistory(
    productId: string,
    storeId?: string,
  ): Promise<PriceHistoryEntity[]> {
    if (storeId) {
      await this.findOneForStore(productId, storeId);
    }
    return this.priceHistoryRepo.find({
      where: { productId },
      order: { changedAt: 'DESC' },
    });
  }

  /**
   * Price analytics: for each price period, calculate sales impact.
   * Returns periods with units sold, revenue, daily averages, and delta vs previous period.
   */
  async getPriceAnalytics(productId: string, storeId: string) {
    const product = await this.findOneForStore(productId, storeId);
    const history = await this.priceHistoryRepo.find({
      where: { productId },
      order: { changedAt: 'ASC' },
    });

    // Build price periods: each change creates a new period
    const periods: {
      priceMinorUnits: number;
      from: Date;
      to: Date;
      changedBy: string;
      changedByRole: string;
      changeSource: string;
      reason: string;
    }[] = [];

    const now = new Date();

    if (history.length === 0) {
      // No price changes — single period since product creation
      periods.push({
        priceMinorUnits: product.priceMinorUnits,
        from: product.createdAt,
        to: now,
        changedBy: 'initial',
        changedByRole: '-',
        changeSource: 'creation',
        reason: 'Prix initial',
      });
    } else {
      // First period: from product creation to first change
      periods.push({
        priceMinorUnits: history[0].oldPriceMinorUnits,
        from: product.createdAt,
        to: history[0].changedAt,
        changedBy: 'initial',
        changedByRole: '-',
        changeSource: 'creation',
        reason: 'Prix initial',
      });

      // Subsequent periods from each price change
      for (let i = 0; i < history.length; i++) {
        const entry = history[i];
        const nextEntry = history[i + 1];
        periods.push({
          priceMinorUnits: entry.newPriceMinorUnits,
          from: entry.changedAt,
          to: nextEntry ? nextEntry.changedAt : now,
          changedBy: entry.changedBy,
          changedByRole: entry.changedByRole || '-',
          changeSource: entry.changeSource || 'unknown',
          reason: entry.reason || '-',
        });
      }
    }

    // Margin basis — Phase 1 uses the product's CURRENT cost for every period.
    // (There is no cost-history table yet; past-period margins are therefore an
    //  approximation. Surfaced to the caller via `costBasis` below.)
    const cost = product.costMinorUnits ?? 0;
    const costAvailable = cost > 0;

    // For each period, query sales data
    const analytics: any[] = [];
    for (let i = 0; i < periods.length; i++) {
      const period = periods[i];
      const daysDuration = Math.max(1, Math.ceil(
        (period.to.getTime() - period.from.getTime()) / (1000 * 60 * 60 * 24),
      ));

      // Query: sum quantities and revenue for this product in this period
      const result = await this.productRepo.manager.query(
        `SELECT
           COALESCE(SUM(li.quantity), 0) AS units_sold,
           COALESCE(SUM(li.line_total_minor_units), 0) AS revenue
         FROM sale_line_items li
         JOIN sales s ON s.id = li.sale_id
         WHERE li.product_id = $1
           AND s.store_id = $2
           AND s.status = 'completed'
           AND s.created_at >= $3
           AND s.created_at < $4`,
        [productId, storeId, period.from.toISOString(), period.to.toISOString()],
      );

      const unitsSold = parseInt(result[0]?.units_sold || '0', 10);
      const revenue = parseInt(result[0]?.revenue || '0', 10);
      const unitsPerDay = Math.round((unitsSold / daysDuration) * 100) / 100;
      // Keep revenue/day in MINOR units internally for correct delta math…
      const revenuePerDayMinorUnits = Math.round(revenue / daysDuration);

      // ── Margin (cash signal) — uses current cost as basis (see note above) ──
      const marginPerUnitMinorUnits = costAvailable
        ? period.priceMinorUnits - cost
        : null;
      const marginPercent =
        costAvailable && period.priceMinorUnits > 0
          ? Math.round(((period.priceMinorUnits - cost) / period.priceMinorUnits) * 10000) / 100
          : null;
      const totalMarginMinorUnits =
        marginPerUnitMinorUnits !== null ? marginPerUnitMinorUnits * unitsSold : null;
      const marginPerDayMinorUnits =
        totalMarginMinorUnits !== null
          ? Math.round(totalMarginMinorUnits / daysDuration)
          : null;

      // Delta vs previous period (all computed from MINOR-unit fields)
      const prev: any = i > 0 ? analytics[i - 1] : null;
      const pct = (cur: number, prv: number): number | null =>
        prv === 0 ? null : Math.round(((cur - prv) / prv) * 10000) / 100;

      const priceDeltaPct = prev ? pct(period.priceMinorUnits, prev.priceMinorUnits) : null;
      const unitsPerDayDeltaPct = prev ? pct(unitsPerDay, prev.unitsPerDay) : null;
      const revenuePerDayDeltaPct = prev
        ? pct(revenuePerDayMinorUnits, prev.revenuePerDayMinorUnits)
        : null;
      const marginPerDayDeltaPct =
        prev && marginPerDayMinorUnits !== null && prev.marginPerDayMinorUnits !== null
          ? pct(marginPerDayMinorUnits, prev.marginPerDayMinorUnits)
          : null;

      // ── Verdict: judge this price change vs the previous period ──
      const verdict: PriceVerdict | null = prev
        ? computePriceVerdict(
            {
              priceMinorUnits: prev.priceMinorUnits,
              unitsPerDay: prev.unitsPerDay,
              marginPerDayMinorUnits: prev.marginPerDayMinorUnits,
              daysDuration: prev.daysDuration,
              unitsSold: prev.unitsSold,
            },
            {
              priceMinorUnits: period.priceMinorUnits,
              unitsPerDay,
              marginPerDayMinorUnits,
              daysDuration,
              unitsSold,
            },
          )
        : null;

      analytics.push({
        periodIndex: i,
        priceMinorUnits: period.priceMinorUnits,
        priceEuros: period.priceMinorUnits / 100,
        from: period.from.toISOString(),
        to: period.to.toISOString(),
        daysDuration,
        unitsSold,
        revenueMinorUnits: revenue,
        revenueEuros: revenue / 100,
        unitsPerDay,
        revenuePerDayMinorUnits,
        // Kept for backward compatibility (frontend reads euros here)
        revenuePerDay: revenuePerDayMinorUnits / 100,
        // ── Margin fields (new) ──
        costMinorUnits: costAvailable ? cost : null,
        marginPerUnitMinorUnits,
        marginPercent,
        totalMarginMinorUnits,
        marginPerDayMinorUnits,
        marginPerDayEuros:
          marginPerDayMinorUnits !== null ? marginPerDayMinorUnits / 100 : null,
        changedBy: period.changedBy,
        changedByRole: period.changedByRole,
        changeSource: period.changeSource,
        reason: period.reason,
        // Delta vs previous period
        vs: prev
          ? {
              priceDeltaPct,
              unitsPerDayDeltaPct,
              revenuePerDayDeltaPct,
              marginPerDayDeltaPct,
            }
          : null,
        // ── Verdict (new) ──
        verdict,
      });
    }

    return {
      productId,
      productName: product.name,
      currentPriceMinorUnits: product.priceMinorUnits,
      currentCostMinorUnits: costAvailable ? cost : null,
      // How margin was derived — current cost applied to all periods (Phase 1)
      costBasis: costAvailable ? 'current_cost_approx' : 'no_cost',
      periods: analytics,
    };
  }

  /**
   * Generate an internal barcode (EAN-13 format with prefix 290)
   * for products that don't have a barcode from their supplier.
   */
  async generateBarcode(productId: string, storeId: string): Promise<ProductEntity> {
    const product = await this.findOneForStore(productId, storeId);

    // Don't overwrite imported barcodes
    if (product.barcodeSource === 'imported' && product.ean && !product.ean.startsWith('290')) {
      throw new BadRequestException(
        'Ce produit a déjà un code-barres fournisseur. Utilisez la modification manuelle pour le changer.',
      );
    }

    // Generate unique EAN-13 with prefix 290 (internal use)
    let ean: string;
    let attempts = 0;
    do {
      // 290 + 9 random digits + 1 check digit = 13 chars
      const random = String(Math.floor(Math.random() * 1_000_000_000)).padStart(9, '0');
      const partial = `290${random}`;
      // EAN-13 check digit
      let sum = 0;
      for (let i = 0; i < 12; i++) {
        sum += parseInt(partial[i]) * (i % 2 === 0 ? 1 : 3);
      }
      const checkDigit = (10 - (sum % 10)) % 10;
      ean = `${partial}${checkDigit}`;

      // Verify uniqueness
      const existing = await this.productRepo.findOne({ where: { ean, storeId } });
      if (!existing || existing.id === productId) break;
      attempts++;
    } while (attempts < 10);

    if (attempts >= 10) {
      throw new BadRequestException('Impossible de générer un code-barres unique. Réessayez.');
    }

    product.ean = ean;
    product.barcodeSource = 'generated';
    return this.productRepo.save(product);
  }
}
