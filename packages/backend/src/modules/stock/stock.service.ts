import {
  Injectable,
  Logger,
  ForbiddenException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { ProductEntity } from '../../database/entities/product.entity';
import { IntegrationEventEntity } from '../../database/entities/integration-event.entity';
import { AuditService } from '../audit/audit.service';
import { crossedDownward, effectiveAlertThreshold, applyStockAdjustment } from './stock-level';
import { recordAdjustMovement } from './stock-movement-journal';
import { toOutboxRow } from '../../common/integration/integration-event';
import { buildStockEvents } from './stock-events';
import { computeStockVariance } from './stock-variance';
import { StoreOrgResolver } from '../integration/store-org-resolver';
import type { EntityManager } from 'typeorm';

@Injectable()
export class StockService {
  private readonly logger = new Logger(StockService.name);

  constructor(
    @InjectRepository(ProductEntity)
    private productRepo: Repository<ProductEntity>,
    @InjectRepository(IntegrationEventEntity)
    private outbox: Repository<IntegrationEventEntity>,
    private auditService: AuditService,
    private dataSource: DataSource,
    private storeOrgResolver: StoreOrgResolver,
  ) {}

  /** Best-effort stock outbox events (Analytik R). Never blocks stock ops. */
  private async emitStockEvents(
    args: {
      productId: string; storeId: string; employeeId?: string | null;
      ean: string | null; productName: string; newQuantity: number;
      deltaQuantity: number; reason: string; lowStockThreshold?: number | null;
    },
    manager?: EntityManager,
  ): Promise<void> {
    try {
      const organizationId = await this.storeOrgResolver.resolve(args.storeId); // POS-INT-89
      const rows = buildStockEvents({ ...args, organizationId }).map(toOutboxRow) as any;
      if (manager) await manager.insert(IntegrationEventEntity, rows);
      else await this.outbox.insert(rows);
    } catch (e: any) {
      this.logger.warn(`Outbox (stock) failed for ${args.productId}: ${e?.message}`);
    }
  }

  /** Find product only if it belongs to the given store */
  private async findProductForStore(
    productId: string,
    storeId: string,
  ): Promise<ProductEntity> {
    const product = await this.productRepo.findOne({
      where: { id: productId, storeId },
    });
    if (!product) {
      throw new ForbiddenException(
        'Product not found or belongs to another store.',
      );
    }
    return product;
  }

  async decrementStock(
    productId: string,
    quantity: number,
    storeId: string,
    employeeId: string,
  ): Promise<ProductEntity> {
    // Use atomic UPDATE to avoid race conditions
    await this.productRepo
      .createQueryBuilder()
      .update(ProductEntity)
      .set({
        stockQuantity: () => `GREATEST(0, "stock_quantity" - :qty)`,
      })
      .where('id = :id AND store_id = :storeId', {
        id: productId,
        storeId,
        qty: quantity,
      })
      .execute();

    // Re-fetch for threshold checks
    const saved = await this.findProductForStore(productId, storeId);
    const estimatedOldQty = saved.stockQuantity + quantity;

    // Check thresholds and emit alerts (only at the moment of crossing — POS-083).
    if (
      crossedDownward(estimatedOldQty, saved.stockQuantity, saved.stockCriticalThreshold)
    ) {
      this.logger.warn(
        `CRITICAL STOCK: ${saved.name} (${saved.ean}) = ${saved.stockQuantity} units (threshold: ${saved.stockCriticalThreshold})`,
      );
      await this.auditService.log({
        storeId,
        employeeId,
        action: 'stock_adjustment',
        entityType: 'product',
        entityId: productId,
        details: {
          level: 'critical',
          productName: saved.name,
          ean: saved.ean,
          stockQuantity: saved.stockQuantity,
          threshold: saved.stockCriticalThreshold,
        },
      });
    } else if (
      crossedDownward(
        estimatedOldQty,
        saved.stockQuantity,
        effectiveAlertThreshold(saved.stockBaselineQuantity, saved.stockAlertThreshold),
      )
    ) {
      const alertThreshold = effectiveAlertThreshold(
        saved.stockBaselineQuantity,
        saved.stockAlertThreshold,
      );
      this.logger.warn(
        `LOW STOCK: ${saved.name} (${saved.ean}) = ${saved.stockQuantity} units (threshold: ${alertThreshold})`,
      );
      await this.auditService.log({
        storeId,
        employeeId,
        action: 'stock_adjustment',
        entityType: 'product',
        entityId: productId,
        details: {
          level: 'alert',
          productName: saved.name,
          ean: saved.ean,
          stockQuantity: saved.stockQuantity,
          threshold: alertThreshold,
          baselineQuantity: saved.stockBaselineQuantity ?? null,
        },
      });
    }

    // Analytik R — stock movement / low / rupture (best-effort, non-blocking).
    await this.emitStockEvents({
      productId, storeId, employeeId,
      ean: saved.ean, productName: saved.name,
      newQuantity: saved.stockQuantity, deltaQuantity: -quantity, reason: 'sale_decrement',
      lowStockThreshold: effectiveAlertThreshold(saved.stockBaselineQuantity, saved.stockAlertThreshold),
    });

    return saved;
  }

  async adjustStock(
    productId: string,
    quantity: number,
    storeId: string,
    employeeId: string,
    reason: string,
    mode: 'absolute' | 'delta' = 'absolute',
  ): Promise<ProductEntity> {
    // Use transaction with pessimistic lock to prevent race conditions
    const { saved, oldQty } = await this.dataSource.transaction(async (manager) => {
      const product = await manager.findOne(ProductEntity, {
        where: { id: productId, storeId },
        lock: { mode: 'pessimistic_write' },
      });

      if (!product) {
        throw new ForbiddenException(
          'Product not found or belongs to another store.',
        );
      }

      const oldQty = product.stockQuantity ?? 0;

      // Delta adds/subtracts; absolute sets. Both clamp ≥ 0 (pure helper).
      product.stockQuantity = applyStockAdjustment(oldQty, quantity, mode);

      const saved = await manager.save(product);

      // POS-081 (option 1, STOCK_UNIFICATION_DECISION.md): journal append-only de
      // l'ajustement (delta signé réel = après − avant), même transaction.
      await recordAdjustMovement(manager, {
        storeId,
        actor: { employeeId },
        productId,
        deltaQuantity: saved.stockQuantity - oldQty,
        reason,
      });

      this.logger.log(
        `Stock adjusted: ${product.name} (${product.ean}) ${oldQty} → ${saved.stockQuantity} (mode=${mode}, value=${quantity}, reason=${reason})`,
      );

      // Audit
      await this.auditService.log({
        storeId,
        employeeId,
        action: 'stock_adjustment',
        entityType: 'product',
        entityId: productId,
        details: {
          oldQuantity: oldQty,
          newQuantity: saved.stockQuantity,
          inputValue: quantity,
          mode,
          reason,
          productName: product.name,
        },
      });

      return { saved, oldQty };
    });

    // Analytik R — stock movement / low / rupture, AFTER commit (best-effort, never
    // rolls back the adjustment). POS-INT-134 — a manual adjustment that crosses
    // the low-stock threshold must signal stock.low too (parity with the sale path).
    await this.emitStockEvents({
      productId, storeId, employeeId,
      ean: saved.ean, productName: saved.name,
      newQuantity: saved.stockQuantity, deltaQuantity: saved.stockQuantity - oldQty, reason,
      lowStockThreshold: effectiveAlertThreshold(saved.stockBaselineQuantity, saved.stockAlertThreshold),
    });

    return saved;
  }

  async updateDefaultThresholds(
    storeId: string,
    alertThreshold: number,
    criticalThreshold: number,
  ): Promise<{ updated: number }> {
    const result = await this.productRepo
      .createQueryBuilder()
      .update(ProductEntity)
      .set({
        stockAlertThreshold: alertThreshold,
        stockCriticalThreshold: criticalThreshold,
      })
      .where('"store_id" = :storeId', { storeId })
      .andWhere('"is_active" = true')
      .execute();

    this.logger.log(
      `Updated default thresholds for store ${storeId}: alert=${alertThreshold}, critical=${criticalThreshold} (${result.affected} products)`,
    );

    return { updated: result.affected || 0 };
  }

  /**
   * Get stock alerts using SQL WHERE instead of loading all products into memory.
   */
  async getAlerts(storeId: string): Promise<{
    alert: ProductEntity[];
    critical: ProductEntity[];
  }> {
    // Critical: stock <= critical threshold
    const critical = await this.productRepo
      .createQueryBuilder('p')
      .where('p.store_id = :storeId', { storeId })
      .andWhere('p.is_active = true')
      .andWhere('p.stock_quantity <= p.stock_critical_threshold')
      .orderBy('p.stock_quantity', 'ASC')
      .getMany();

    // Alert: stock <= effective alert threshold AND stock > critical threshold.
    // POS-083: effective threshold = 20% of the par/max baseline when set, else the
    // absolute `stock_alert_threshold` (COALESCE fallback → no change when baseline NULL).
    const alert = await this.productRepo
      .createQueryBuilder('p')
      .where('p.store_id = :storeId', { storeId })
      .andWhere('p.is_active = true')
      .andWhere(
        'p.stock_quantity <= COALESCE(CEIL(p.stock_baseline_quantity * 0.2), p.stock_alert_threshold)',
      )
      .andWhere('p.stock_quantity > p.stock_critical_threshold')
      .orderBy('p.stock_quantity', 'ASC')
      .getMany();

    return { alert, critical };
  }

  /**
   * POS-INT-152 — inventory variance (read-only). Given physical counts (by
   * productId or EAN), resolve store products, then compute system-vs-counted
   * gaps valued at cost. No persistence, no stock mutation — decision support.
   * Counts referencing an unknown product (other store / bad code) are reported.
   */
  async computeVariance(
    storeId: string,
    counts: { productId?: string; ean?: string; countedQty: number }[],
  ): Promise<ReturnType<typeof computeStockVariance> & { unmatched: string[] }> {
    const ids = counts.map((c) => c.productId).filter((x): x is string => !!x);
    const eans = counts.map((c) => c.ean).filter((x): x is string => !!x);
    const products = await this.productRepo
      .createQueryBuilder('p')
      .where('p.store_id = :storeId', { storeId })
      .andWhere(
        '(p.id IN (:...ids) OR p.ean IN (:...eans))',
        { ids: ids.length ? ids : ['__none__'], eans: eans.length ? eans : ['__none__'] },
      )
      .getMany();

    const byId = new Map(products.map((p) => [p.id, p]));
    const byEan = new Map(products.map((p) => [p.ean, p]));
    const rows = [];
    const unmatched: string[] = [];
    for (const c of counts) {
      const p = (c.productId && byId.get(c.productId)) || (c.ean && byEan.get(c.ean)) || null;
      if (!p) { unmatched.push(c.productId || c.ean || '?'); continue; }
      rows.push({
        productId: p.id,
        name: p.name,
        ean: p.ean,
        systemQty: p.stockQuantity,
        countedQty: Number(c.countedQty) || 0,
        costMinorUnits: p.costMinorUnits ?? 0,
      });
    }
    return { ...computeStockVariance(rows), unmatched };
  }
}
