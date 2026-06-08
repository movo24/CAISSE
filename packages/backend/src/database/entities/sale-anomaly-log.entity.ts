import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';
import {
  AnomalyStatus,
  GuardSeverity,
} from '../../modules/sales-guards/sales-guards.types';

/**
 * Append-style log of every sale anomaly detected by the guard engine.
 *
 * This is a SEPARATE audit table — the guard engine never writes to validated
 * sales/tickets (NF525). Only `status` is mutated (detected → approved/ignored
 * /resolved) by an authorised reviewer.
 */
@Entity('sale_anomaly_logs')
@Index(['storeId', 'createdAt'])
@Index(['sellerId', 'createdAt'])
@Index(['code'])
@Index(['status'])
export class SaleAnomalyLogEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'store_id', type: 'uuid' })
  storeId: string;

  @Column({ name: 'seller_id', type: 'uuid' })
  sellerId: string;

  @Column({ name: 'sale_id', type: 'uuid', nullable: true })
  saleId: string | null;

  @Column({ name: 'product_id', type: 'uuid', nullable: true })
  productId: string | null;

  @Column({ type: 'varchar', length: 50 })
  code: string;

  @Column({ type: 'varchar', length: 20 })
  severity: GuardSeverity;

  @Column({ type: 'boolean', default: false })
  blocking: boolean;

  @Column({ name: 'manager_approval_required', type: 'boolean', default: false })
  managerApprovalRequired: boolean;

  @Column({ type: 'text' })
  message: string;

  @Column({ type: 'jsonb', nullable: true })
  metadata: Record<string, unknown> | null;

  @Column({ type: 'varchar', length: 20, default: 'detected' })
  status: AnomalyStatus;

  /** Employee UUID who approved/ignored/resolved */
  @Column({ name: 'reviewed_by', type: 'uuid', nullable: true })
  reviewedBy: string | null;

  @Column({ name: 'reviewed_at', type: 'timestamp', nullable: true })
  reviewedAt: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
