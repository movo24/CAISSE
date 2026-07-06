import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  HttpStatus,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ProductEntity } from '../../database/entities/product.entity';
import { PriceHistoryEntity } from '../../database/entities/price-history.entity';
import { ProductCategoryEntity } from '../../database/entities/product-category.entity';
import { BrandEntity } from '../../database/entities/brand.entity';
import { SupplierEntity } from '../../database/entities/supplier.entity';
import { StoreProductPriceEntity } from '../../database/entities/store-product-price.entity';
import { AuditService } from '../audit/audit.service';
import { PaginatedResult } from '../../common/dto/pagination.dto';
import { computePriceVerdict, PriceVerdict } from './price-verdict';
import { toCsv, parseCsvWithHeader, stripFormulaGuard } from '../../common/csv/csv.util';
import { BusinessError } from '../../common/errors/business-error';

/** Canonical CSV columns — export emits these; import reads these (round-trip). */
const CSV_COLUMNS = [
  'ean',
  'name',
  'price_minor_units',
  'tax_rate',
  'cost_minor_units',
  'unit_type',
  'is_active',
  'brand',
  'supplier',
] as const;

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
    @InjectRepository(BrandEntity)
    private brandRepo: Repository<BrandEntity>,
    @InjectRepository(SupplierEntity)
    private supplierRepo: Repository<SupplierEntity>,
    @InjectRepository(StoreProductPriceEntity)
    private storePriceRepo: Repository<StoreProductPriceEntity>,
  ) {}

  // ── Per-store price override (decision 4) ──

  /**
   * The effective price for a product NOW: an active store override (within its
   * optional window) wins over the product's base price. Single source used by
   * the sale path and any price read.
   */
  async resolveEffectivePrice(product: ProductEntity, now: Date = new Date()): Promise<number> {
    const override = await this.storePriceRepo.findOne({ where: { productId: product.id } });
    if (!override || !override.isActive) return product.priceMinorUnits;
    if (override.startsAt && now < new Date(override.startsAt)) return product.priceMinorUnits;
    if (override.endsAt && now > new Date(override.endsAt)) return product.priceMinorUnits;
    return override.priceMinorUnits;
  }

  async getStoreOverride(storeId: string, productId: string): Promise<StoreProductPriceEntity | null> {
    await this.findOneForStore(productId, storeId); // tenant guard
    return this.storePriceRepo.findOne({ where: { productId, storeId } });
  }

  /** Set/replace a store override (historised) — the override wins at sale time. */
  async setStoreOverride(
    storeId: string,
    productId: string,
    priceMinorUnits: number,
    employeeId: string,
    window?: { startsAt?: Date | null; endsAt?: Date | null },
    employeeRole?: string,
  ): Promise<StoreProductPriceEntity> {
    if (!Number.isInteger(priceMinorUnits) || priceMinorUnits < 0) {
      throw new BadRequestException('priceMinorUnits must be an integer ≥ 0');
    }
    const product = await this.findOneForStore(productId, storeId); // tenant guard
    const existing = await this.storePriceRepo.findOne({ where: { productId, storeId } });
    const oldEffective = await this.resolveEffectivePrice(product);

    const row = existing
      ? Object.assign(existing, { priceMinorUnits, isActive: true, startsAt: window?.startsAt ?? null, endsAt: window?.endsAt ?? null })
      : this.storePriceRepo.create({ storeId, productId, priceMinorUnits, isActive: true, startsAt: window?.startsAt ?? null, endsAt: window?.endsAt ?? null });
    const saved = await this.storePriceRepo.save(row);

    // Historise the change (decision: "tout changement de prix doit être historisé").
    await this.priceHistoryRepo.save({
      productId,
      oldPriceMinorUnits: oldEffective,
      newPriceMinorUnits: priceMinorUnits,
      changedBy: employeeId,
      storeId,
      reason: 'Store price override',
      changeSource: 'store_override',
      changedByRole: employeeRole || 'unknown',
    });
    await this.auditService.log({
      storeId,
      employeeId,
      action: 'price_change',
      entityType: 'product',
      entityId: productId,
      details: { override: priceMinorUnits, base: product.priceMinorUnits, source: 'store_override' },
    });
    return saved;
  }

  /** Clear the override (back to the base price) — historised. */
  async clearStoreOverride(storeId: string, productId: string, employeeId: string, employeeRole?: string): Promise<{ cleared: boolean }> {
    const product = await this.findOneForStore(productId, storeId); // tenant guard
    const existing = await this.storePriceRepo.findOne({ where: { productId, storeId } });
    if (!existing) return { cleared: false };
    const oldEffective = await this.resolveEffectivePrice(product);
    await this.storePriceRepo.delete({ id: existing.id });
    await this.priceHistoryRepo.save({
      productId,
      oldPriceMinorUnits: oldEffective,
      newPriceMinorUnits: product.priceMinorUnits,
      changedBy: employeeId,
      storeId,
      reason: 'Store price override cleared',
      changeSource: 'store_override',
      changedByRole: employeeRole || 'unknown',
    });
    return { cleared: true };
  }

  // ── Variants / SKU (decision 5): a variant is a product row with a parent ──

  /**
   * Create a variant under a parent product. The variant is a full product row
   * (own ean / price / stock / active) inheriting tax/category/brand/supplier
   * from the parent — so it sells, prices and stocks through the normal paths.
   */
  async createVariant(
    parentId: string,
    storeId: string,
    dto: { ean: string; variantName: string; priceMinorUnits: number; sku?: string; stockQuantity?: number; taxRate?: number; costMinorUnits?: number },
    employeeId: string,
  ): Promise<ProductEntity> {
    const parent = await this.findOneForStore(parentId, storeId);
    if (parent.parentProductId) throw new BadRequestException('Cannot create a variant of a variant');
    if (!dto.ean?.trim()) throw new BadRequestException('Variant ean is required');
    if (!dto.variantName?.trim()) throw new BadRequestException('variantName is required');
    if (await this.productRepo.findOne({ where: { ean: dto.ean.trim(), storeId } })) {
      throw new BadRequestException(`EAN already used in this store: ${dto.ean}`);
    }
    if (dto.sku && (await this.productRepo.findOne({ where: { sku: dto.sku.trim(), storeId } }))) {
      throw new BadRequestException(`SKU already used in this store: ${dto.sku}`);
    }
    return this.create(
      {
        ean: dto.ean.trim(),
        name: `${parent.name} — ${dto.variantName.trim()}`,
        variantName: dto.variantName.trim(),
        sku: dto.sku?.trim() || null,
        parentProductId: parent.id,
        priceMinorUnits: dto.priceMinorUnits,
        taxRate: dto.taxRate ?? parent.taxRate,
        costMinorUnits: dto.costMinorUnits ?? null,
        stockQuantity: dto.stockQuantity ?? 0,
        categoryId: parent.categoryId,
        brandId: parent.brandId,
        supplierId: parent.supplierId,
        unitType: parent.unitType,
        isActive: true,
        storeId,
      } as Partial<ProductEntity>,
      employeeId,
    );
  }

  /** List the variants of a parent product (all statuses, for management). */
  async listVariants(parentId: string, storeId: string): Promise<ProductEntity[]> {
    await this.findOneForStore(parentId, storeId); // tenant guard
    return this.productRepo.find({ where: { parentProductId: parentId, storeId }, order: { name: 'ASC' } });
  }

  // ── Brand / supplier reference data (decision 3) ──

  async listBrands(storeId: string): Promise<BrandEntity[]> {
    return this.brandRepo.find({ where: { storeId, isActive: true }, order: { name: 'ASC' } });
  }

  async listSuppliers(storeId: string): Promise<SupplierEntity[]> {
    return this.supplierRepo.find({ where: { storeId, isActive: true }, order: { name: 'ASC' } });
  }

  /** Idempotent by (store, name) — used by manual create and by CSV import. */
  async getOrCreateBrand(storeId: string, name: string): Promise<BrandEntity> {
    const clean = name.trim();
    if (!clean) throw new BadRequestException('Brand name is required');
    const existing = await this.brandRepo.findOne({ where: { storeId, name: clean } });
    if (existing) return existing;
    return this.brandRepo.save(this.brandRepo.create({ storeId, name: clean }));
  }

  async getOrCreateSupplier(storeId: string, name: string): Promise<SupplierEntity> {
    const clean = name.trim();
    if (!clean) throw new BadRequestException('Supplier name is required');
    const existing = await this.supplierRepo.findOne({ where: { storeId, name: clean } });
    if (existing) return existing;
    return this.supplierRepo.save(this.supplierRepo.create({ storeId, name: clean }));
  }

  async create(
    data: Partial<ProductEntity>,
    employeeId: string,
  ): Promise<ProductEntity> {
    // Anti-doublon strict : un code-barres = une seule fiche par magasin,
    // quel que soit son statut (active, en attente, archivée…).
    if (data.ean && data.storeId) {
      const duplicate = await this.productRepo.findOne({
        where: { ean: data.ean.trim(), storeId: data.storeId },
      });
      if (duplicate) {
        throw new BusinessError(
          'PRODUCT_BARCODE_ALREADY_EXISTS',
          `Un produit existe déjà avec ce code-barres (${data.ean}) : ${duplicate.name}.`,
          HttpStatus.CONFLICT,
          {
            existingProduct: {
              id: duplicate.id,
              name: duplicate.name,
              ean: duplicate.ean,
              status: duplicate.status,
              isActive: duplicate.isActive,
            },
          },
        );
      }
    }

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
    options?: { page?: number; limit?: number; search?: string; brandId?: string; supplierId?: string; topLevelOnly?: boolean },
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
    if (options?.brandId) qb.andWhere('p.brand_id = :brandId', { brandId: options.brandId });
    if (options?.supplierId) qb.andWhere('p.supplier_id = :supplierId', { supplierId: options.supplierId });
    if (options?.topLevelOnly) qb.andWhere('p.parent_product_id IS NULL'); // exclude variants

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
    await this.productRepo.update(id, { isActive: false, status: 'archived' });
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

  /**
   * Bloc 4i — export the store catalog as CSV (round-trippable with importCsv).
   * Canonical columns; one row per active product. Read-only.
   */
  async exportCsv(storeId: string): Promise<string> {
    const products = await this.productRepo.find({
      where: { storeId, isActive: true },
      order: { name: 'ASC' },
    });
    // Resolve brand/supplier names once (no N+1).
    const brands = new Map((await this.brandRepo.find({ where: { storeId } })).map((b) => [b.id, b.name]));
    const suppliers = new Map((await this.supplierRepo.find({ where: { storeId } })).map((s) => [s.id, s.name]));
    const rows: Array<Array<string | number | boolean | null>> = [CSV_COLUMNS as unknown as string[]];
    for (const p of products) {
      rows.push([
        p.ean,
        p.name,
        p.priceMinorUnits,
        p.taxRate,
        p.costMinorUnits ?? '',
        p.unitType,
        p.isActive,
        p.brandId ? brands.get(p.brandId) ?? '' : '',
        p.supplierId ? suppliers.get(p.supplierId) ?? '' : '',
      ]);
    }
    return toCsv(rows);
  }

  /**
   * Bloc 4i — bulk import/update products from CSV. Per-row validation
   * (ean+name required, price an integer ≥ 0, tax/cost numeric); a row that
   * fails is SKIPPED and reported, never silently dropped. Upsert by (ean,
   * store): existing → update (reuses update() so price history + audit hold),
   * new → create. Returns an honest per-row report.
   */
  async importCsv(
    storeId: string,
    csvText: string,
    employeeId: string,
  ): Promise<{
    total: number;
    created: number;
    updated: number;
    skipped: number;
    errors: Array<{ line: number; ean: string; reason: string }>;
  }> {
    const rows = parseCsvWithHeader(csvText);
    let created = 0;
    let updated = 0;
    let skipped = 0;
    const errors: Array<{ line: number; ean: string; reason: string }> = [];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const line = i + 2; // +1 for header, +1 for 1-based
      const ean = (row.ean ?? '').trim();
      // strip the export formula-guard apostrophe so round-trip is lossless (M105)
      const name = stripFormulaGuard((row.name ?? '').trim());
      const priceRaw = (row.price_minor_units ?? '').trim();
      const fail = (reason: string) => {
        errors.push({ line, ean, reason });
        skipped++;
      };

      if (!ean) {
        fail('ean manquant');
        continue;
      }
      if (!name) {
        fail('name manquant');
        continue;
      }
      const price = Number(priceRaw);
      if (priceRaw === '' || !Number.isInteger(price) || price < 0) {
        fail(`price_minor_units invalide: "${priceRaw}" (entier ≥ 0 attendu)`);
        continue;
      }
      const taxRaw = (row.tax_rate ?? '').trim();
      const taxRate = taxRaw === '' ? 20 : Number(taxRaw);
      if (Number.isNaN(taxRate) || taxRate < 0) {
        fail(`tax_rate invalide: "${taxRaw}"`);
        continue;
      }
      const costRaw = (row.cost_minor_units ?? '').trim();
      let costMinorUnits: number | undefined;
      if (costRaw !== '') {
        const cost = Number(costRaw);
        if (!Number.isInteger(cost) || cost < 0) {
          fail(`cost_minor_units invalide: "${costRaw}"`);
          continue;
        }
        costMinorUnits = cost;
      }
      const unitType = (row.unit_type ?? '').trim() || undefined;
      const activeRaw = (row.is_active ?? '').trim().toLowerCase();
      const isActive = activeRaw === '' ? true : ['true', '1', 'yes', 'oui'].includes(activeRaw);

      try {
        // Resolve brand/supplier by name (created on demand, store-scoped).
        const brandName = stripFormulaGuard((row.brand ?? '').trim());
        const supplierName = stripFormulaGuard((row.supplier ?? '').trim());
        const brandId = brandName ? (await this.getOrCreateBrand(storeId, brandName)).id : undefined;
        const supplierId = supplierName ? (await this.getOrCreateSupplier(storeId, supplierName)).id : undefined;

        const existing = await this.productRepo.findOne({ where: { ean, storeId } });
        if (existing) {
          await this.update(
            existing.id,
            {
              name,
              priceMinorUnits: price,
              taxRate,
              ...(costMinorUnits !== undefined ? { costMinorUnits } : {}),
              ...(unitType ? { unitType } : {}),
              ...(brandId ? { brandId } : {}),
              ...(supplierId ? { supplierId } : {}),
              isActive,
            },
            employeeId,
            'CSV import',
            storeId,
            'csv_import',
          );
          updated++;
        } else {
          await this.create(
            {
              ean,
              name,
              priceMinorUnits: price,
              taxRate,
              costMinorUnits,
              unitType,
              brandId,
              supplierId,
              isActive,
              storeId,
            } as Partial<ProductEntity>,
            employeeId,
          );
          created++;
        }
      } catch (e: any) {
        fail(e?.message ?? 'erreur inattendue');
      }
    }

    return { total: rows.length, created, updated, skipped, errors };
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

  async getStockAlerts(
    storeId: string,
    options: { page?: number; limit?: number } = {},
  ): Promise<{
    alert: ProductEntity[];
    critical: ProductEntity[];
    alertTotal: number;
    criticalTotal: number;
    page: number;
    limit: number;
  }> {
    // Paginate to avoid loading an unbounded set on large catalogues.
    const limit = Math.min(Math.max(options.limit ?? 50, 1), 100);
    const page = Math.max(options.page ?? 1, 1);
    const skip = (page - 1) * limit;

    const [alert, alertTotal] = await this.productRepo
      .createQueryBuilder('p')
      .where('p.store_id = :storeId', { storeId })
      .andWhere('p.is_active = true')
      .andWhere('p.stock_quantity <= p.stock_alert_threshold')
      .andWhere('p.stock_quantity > p.stock_critical_threshold')
      .orderBy('p.stock_quantity', 'ASC')
      .skip(skip)
      .take(limit)
      .getManyAndCount();

    const [critical, criticalTotal] = await this.productRepo
      .createQueryBuilder('p')
      .where('p.store_id = :storeId', { storeId })
      .andWhere('p.is_active = true')
      .andWhere('p.stock_quantity <= p.stock_critical_threshold')
      .orderBy('p.stock_quantity', 'ASC')
      .skip(skip)
      .take(limit)
      .getManyAndCount();

    return { alert, critical, alertTotal, criticalTotal, page, limit };
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

    // Fetch ALL completed sale lines for this product ONCE, then bucket per period
    // in memory (previously one SQL query per period → N+1).
    const allLines: { ts: number; quantity: number; revenue: number }[] = (
      await this.productRepo.manager.query(
        `SELECT s.created_at AS created_at, li.quantity AS quantity, li.line_total_minor_units AS revenue
           FROM sale_line_items li
           JOIN sales s ON s.id = li.sale_id
          WHERE li.product_id = $1 AND s.store_id = $2 AND s.status = 'completed'`,
        [productId, storeId],
      )
    ).map((r: any) => ({
      ts: new Date(r.created_at).getTime(),
      quantity: parseInt(r.quantity || '0', 10),
      revenue: parseInt(r.revenue || '0', 10),
    }));

    // For each period, aggregate the in-memory lines
    const analytics: any[] = [];
    for (let i = 0; i < periods.length; i++) {
      const period = periods[i];
      const daysDuration = Math.max(1, Math.ceil(
        (period.to.getTime() - period.from.getTime()) / (1000 * 60 * 60 * 24),
      ));

      // Aggregate in-memory lines falling in [from, to) for this period.
      const fromTs = period.from.getTime();
      const toTs = period.to.getTime();
      let unitsSold = 0;
      let revenue = 0;
      for (const line of allLines) {
        if (line.ts >= fromTs && line.ts < toTs) {
          unitsSold += line.quantity;
          revenue += line.revenue;
        }
      }
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
