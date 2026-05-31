import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

export type SyncDirection = 'EXPORT' | 'IMPORT';
export type SyncStatus = 'SUCCESS' | 'PARTIAL' | 'FAILED';
export type SyncTrigger = 'CRON' | 'MANUAL' | 'WEBHOOK';

/**
 * Append-only log of every sync batch between POS and Airtable.
 * Never UPDATE or DELETE rows — use for audit trail.
 */
@Entity('airtable_sync_logs')
@Index(['storeId', 'createdAt'])
@Index(['entityType', 'direction'])
@Index(['status'])
export class AirtableSyncLogEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 10 })
  direction: SyncDirection;

  /** e.g. 'product' | 'store' | 'supplier' */
  @Column({ name: 'entity_type', type: 'varchar', length: 50 })
  entityType: string;

  @Column({ name: 'airtable_table_id', type: 'varchar', length: 64 })
  airtableTableId: string;

  /** null means the sync covered all stores */
  @Column({ name: 'store_id', type: 'uuid', nullable: true })
  storeId: string | null;

  @Column({ name: 'records_processed', type: 'int', default: 0 })
  recordsProcessed: number;

  @Column({ name: 'records_failed', type: 'int', default: 0 })
  recordsFailed: number;

  @Column({ name: 'duration_ms', type: 'int', default: 0 })
  durationMs: number;

  @Column({ type: 'varchar', length: 10 })
  status: SyncStatus;

  /** Populated when status is PARTIAL or FAILED */
  @Column({ name: 'error_message', type: 'text', nullable: true })
  errorMessage: string | null;

  @Column({ name: 'triggered_by', type: 'varchar', length: 20 })
  triggeredBy: SyncTrigger;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
