import {
  Injectable,
  Logger,
  ForbiddenException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { ProductEntity } from '../../database/entities/product.entity';
import { AuditService } from '../audit/audit.service';
import { crossedDownward, effectiveAlertThreshold } from './stock-level';

@Injectable()
export class StockService {
  private readonly logger = new Logger(StockService.name);

  constructor(
    @InjectRepository(ProductEntity)
    private productRepo: Repository<ProductEntity>,
    private auditService: AuditService,
    private dataSource: DataSource,
  ) {}

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
    return this.dataSource.transaction(async (manager) => {
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

      if (mode === 'delta') {
        // Delta mode: add/subtract from current stock
        product.stockQuantity = Math.max(0, oldQty + quantity);
      } else {
        // Absolute mode: set to exact value (must be >= 0)
        product.stockQuantity = Math.max(0, quantity);
      }

      const saved = await manager.save(product);

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

      return saved;
    });
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
}
