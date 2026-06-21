import { Entity, PrimaryGeneratedColumn, Column, Index, CreateDateColumn } from 'typeorm';

/**
 * StockVariance — a flagged shortage between theoretical and physical stock that
 * requires HUMAN intervention (decision: a shortage ≥ 20% never self-corrects).
 *
 * Created when an inventory count shows physical < theoretical by ≥ threshold.
 * The manager must verify the shelf, confirm the real quantity, give a mandatory
 * reason, and validate the correction — only then is stock adjusted. Nothing is
 * auto-corrected; every transition is audited.
 */
@Entity('stock_variances')
@Index(['storeId', 'status'])
export class StockVarianceEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'store_id', type: 'uuid' })
  storeId: string;

  @Column({ name: 'product_id', type: 'uuid' })
  productId: string;

  @Column({ name: 'theoretical_qty', type: 'integer' })
  theoreticalQty: number;

  @Column({ name: 'physical_qty', type: 'integer' })
  physicalQty: number;

  /** Shortage percentage at detection time (theoretical → physical). */
  @Column({ name: 'variance_pct', type: 'decimal', precision: 6, scale: 2 })
  variancePct: number;

  @Column({ type: 'varchar', length: 20, default: 'pending_review' })
  status: 'pending_review' | 'corrected' | 'rejected';

  /** Mandatory at correction time — one of the allowed loss reasons. */
  @Column({ type: 'varchar', length: 30, nullable: true })
  reason: string | null;

  @Column({ name: 'detected_by', type: 'uuid' })
  detectedBy: string;

  @Column({ name: 'reviewed_by', type: 'uuid', nullable: true })
  reviewedBy: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @Column({ name: 'reviewed_at', type: 'timestamp', nullable: true })
  reviewedAt: Date | null;
}
