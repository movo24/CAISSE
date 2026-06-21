import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ProductEntity } from '../../database/entities/product.entity';
import { StockVarianceEntity } from '../../database/entities/stock-variance.entity';
import { StockService } from '../stock/stock.service';
import { AuditService } from '../audit/audit.service';
import { AlertService } from '../../common/alert/alert.service';

/** Allowed reasons for a validated correction (decision 7). */
export const VARIANCE_REASONS = ['casse', 'vol', 'erreur_inventaire', 'perte', 'perime', 'autre'] as const;
export type VarianceReason = (typeof VARIANCE_REASONS)[number];

/** Shortage ≥ this % between theoretical and physical → human intervention. */
const THRESHOLD_PCT = Number(process.env.STOCK_VARIANCE_THRESHOLD_PCT ?? 20);

/**
 * Stock reconciliation (decision 7): an inventory count is compared to the
 * theoretical stock. A shortage ≥ THRESHOLD_PCT is FLAGGED for human review and
 * NOT applied (no silent correction of a large loss); the manager confirms the
 * real quantity with a mandatory reason and validates. Smaller variances and
 * overages are applied directly (audited).
 */
@Injectable()
export class StockReconciliationService {
  private readonly logger = new Logger(StockReconciliationService.name);

  constructor(
    @InjectRepository(ProductEntity) private readonly products: Repository<ProductEntity>,
    @InjectRepository(StockVarianceEntity) private readonly variances: Repository<StockVarianceEntity>,
    private readonly stock: StockService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Submit a physical count for a product. Returns either a flagged variance
   * (requiresReview) for a ≥threshold shortage, or the applied correction.
   */
  async submitCount(
    storeId: string,
    productId: string,
    physicalQty: number,
    employeeId: string,
  ): Promise<
    | { requiresReview: true; variance: StockVarianceEntity }
    | { requiresReview: false; applied: true; theoreticalQty: number; physicalQty: number }
  > {
    if (!Number.isInteger(physicalQty) || physicalQty < 0) {
      throw new BadRequestException('physicalQty must be an integer ≥ 0');
    }
    const product = await this.products.findOne({ where: { id: productId, storeId } });
    if (!product) throw new NotFoundException('Product not found or belongs to another store.');

    const theoretical = product.stockQuantity ?? 0;
    const shortage = theoretical - physicalQty;
    const shortagePct = theoretical > 0 ? (shortage / theoretical) * 100 : 0;

    // Large shortage → human intervention, NO auto-correction.
    if (shortage > 0 && shortagePct >= THRESHOLD_PCT) {
      const variance = await this.variances.save(
        this.variances.create({
          storeId,
          productId,
          theoreticalQty: theoretical,
          physicalQty,
          variancePct: Math.round(shortagePct * 100) / 100,
          status: 'pending_review',
          detectedBy: employeeId,
        }),
      );
      AlertService.instance.fire(
        'STOCK_VARIANCE_HIGH',
        `Écart stock ${shortagePct.toFixed(1)}% sur ${product.name} (${product.ean}) magasin ${storeId} — vérification requise`,
      );
      await this.audit.log({
        storeId,
        employeeId,
        action: 'stock_variance_flagged',
        entityType: 'product',
        entityId: productId,
        details: { theoreticalQty: theoretical, physicalQty, shortagePct: variance.variancePct, varianceId: variance.id },
      });
      this.logger.warn(
        `Stock variance flagged: ${product.ean} ${theoretical}→${physicalQty} (-${shortagePct.toFixed(1)}%) store ${storeId}`,
      );
      return { requiresReview: true, variance };
    }

    // Minor variance or overage → apply directly (audited inside adjustStock).
    await this.stock.adjustStock(productId, physicalQty, storeId, employeeId, 'inventory_count', 'absolute');
    return { requiresReview: false, applied: true, theoreticalQty: theoretical, physicalQty };
  }

  /** The store's variances awaiting a manager decision. */
  async listPending(storeId: string): Promise<StockVarianceEntity[]> {
    return this.variances.find({ where: { storeId, status: 'pending_review' }, order: { createdAt: 'ASC' } });
  }

  /**
   * Manager validates a flagged variance: confirm the real quantity with a
   * mandatory reason → stock is corrected and the variance closed. This is the
   * ONLY path that applies a flagged correction (no silent auto-correction).
   */
  async confirmCorrection(
    varianceId: string,
    storeId: string,
    confirmedQty: number,
    reason: string,
    managerId: string,
  ): Promise<StockVarianceEntity> {
    if (!(VARIANCE_REASONS as readonly string[]).includes(reason)) {
      throw new BadRequestException(`reason must be one of: ${VARIANCE_REASONS.join(', ')}`);
    }
    if (!Number.isInteger(confirmedQty) || confirmedQty < 0) {
      throw new BadRequestException('confirmedQty must be an integer ≥ 0');
    }
    const variance = await this.variances.findOne({ where: { id: varianceId, storeId } });
    if (!variance) throw new NotFoundException('Variance not found for this store.');
    if (variance.status !== 'pending_review') {
      throw new BadRequestException(`Variance is already ${variance.status}`);
    }

    // Apply the manager-confirmed quantity (audited inside adjustStock).
    await this.stock.adjustStock(variance.productId, confirmedQty, storeId, managerId, `inventory_correction:${reason}`, 'absolute');

    variance.status = 'corrected';
    variance.physicalQty = confirmedQty;
    variance.reason = reason;
    variance.reviewedBy = managerId;
    variance.reviewedAt = new Date();
    const saved = await this.variances.save(variance);

    await this.audit.log({
      storeId,
      employeeId: managerId,
      action: 'stock_variance_corrected',
      entityType: 'product',
      entityId: variance.productId,
      details: { varianceId, confirmedQty, reason, theoreticalQty: variance.theoreticalQty },
    });
    return saved;
  }

  /** Manager rejects a variance (recount matched / no real loss) — no stock change. */
  async reject(varianceId: string, storeId: string, managerId: string, note?: string): Promise<StockVarianceEntity> {
    const variance = await this.variances.findOne({ where: { id: varianceId, storeId } });
    if (!variance) throw new NotFoundException('Variance not found for this store.');
    if (variance.status !== 'pending_review') {
      throw new BadRequestException(`Variance is already ${variance.status}`);
    }
    variance.status = 'rejected';
    variance.reviewedBy = managerId;
    variance.reviewedAt = new Date();
    const saved = await this.variances.save(variance);
    await this.audit.log({
      storeId,
      employeeId: managerId,
      action: 'stock_variance_rejected',
      entityType: 'product',
      entityId: variance.productId,
      details: { varianceId, note: note ?? null },
    });
    return saved;
  }
}
