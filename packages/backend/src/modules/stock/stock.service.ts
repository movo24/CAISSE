import {
  Injectable,
  Logger,
  ForbiddenException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { ProductEntity } from '../../database/entities/product.entity';
import { StockMovementEntity } from '../../database/entities/stock-movement.entity';
import { AuditService } from '../audit/audit.service';

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

    // Check thresholds and emit alerts
    if (
      saved.stockQuantity <= saved.stockCriticalThreshold &&
      estimatedOldQty > saved.stockCriticalThreshold
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
      saved.stockQuantity <= saved.stockAlertThreshold &&
      estimatedOldQty > saved.stockAlertThreshold
    ) {
      this.logger.warn(
        `LOW STOCK: ${saved.name} (${saved.ean}) = ${saved.stockQuantity} units (threshold: ${saved.stockAlertThreshold})`,
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
          threshold: saved.stockAlertThreshold,
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
    // Use transaction with pessimistic lock to prevent race conditions.
    // Phantom-audit fix (D16 class 3): the audit is emitted AFTER this transaction
    // commits — never inside the open tx — so a rolled-back adjustment can no longer
    // leave a committed audit entry behind. Amounts/quantities/logic are unchanged.
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

      if (mode === 'delta') {
        // Delta mode: add/subtract from current stock
        product.stockQuantity = Math.max(0, oldQty + quantity);
      } else {
        // Absolute mode: set to exact value (must be >= 0)
        product.stockQuantity = Math.max(0, quantity);
      }

      const saved = await manager.save(product);

      // --- Journal de stock unifié — bloc F1b (shadow, flag OFF par défaut).
      // L'ajustement écrit son mouvement dans la MÊME tx que le scalaire (jamais
      // d'ajustement committé sans son mouvement, ni l'inverse).
      // CONVENTION RATIFIÉE (GO owner) : `quantity` = DELTA SIGNÉ (new − old) —
      // exception UNIQUE et documentée à la règle « quantity toujours positif ».
      // Motif : un ajustement n'a pas de sens in/out intrinsèque (surtout en mode
      // absolu) ; seul le delta est univoque, et la réconciliation l'agrège tel quel
      // (`inventory_adjust` → `+quantity`). Un delta nul n'écrit rien (aucun
      // mouvement réel ; l'audit trace déjà la tentative). ---
      if (process.env.STOCK_JOURNAL_SHADOW === 'true') {
        const delta = (saved.stockQuantity ?? 0) - oldQty;
        if (delta !== 0) {
          await manager.insert(StockMovementEntity, {
            productId,
            movementType: 'inventory_adjust',
            fromLocationId: null,
            toLocationId: null,
            quantity: delta,
            reason,
            employeeId,
            employeeName: employeeId, // ce chemin ne dispose pas d'un snapshot de nom
            storeId,
          });
        }
      }

      this.logger.log(
        `Stock adjusted: ${product.name} (${product.ean}) ${oldQty} → ${saved.stockQuantity} (mode=${mode}, value=${quantity}, reason=${reason})`,
      );

      return { saved, oldQty };
    });

    // Audit AFTER commit, best-effort (an audit failure must never roll back or fail
    // an adjustment that already committed — same pattern as the sales/sync audits).
    try {
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
          productName: saved.name,
        },
      });
    } catch (auditErr: any) {
      this.logger.warn(`Audit (stock_adjustment) failed: ${auditErr?.message}`);
    }

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

    // Alert: stock <= alert threshold AND stock > critical threshold
    const alert = await this.productRepo
      .createQueryBuilder('p')
      .where('p.store_id = :storeId', { storeId })
      .andWhere('p.is_active = true')
      .andWhere('p.stock_quantity <= p.stock_alert_threshold')
      .andWhere('p.stock_quantity > p.stock_critical_threshold')
      .orderBy('p.stock_quantity', 'ASC')
      .getMany();

    return { alert, critical };
  }
}
