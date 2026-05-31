import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

export type AirtableOperationStatus =
  | 'pending'
  | 'approved'
  | 'rejected'
  | 'applied'
  | 'failed';

export type AirtableRiskLevel = 'low' | 'medium' | 'high' | 'critical';

/**
 * Every change proposed by the Airtable ops team is stored here as a
 * pending operation.  Nothing is ever applied to POS data automatically —
 * only an authorised human review + explicit apply action can mutate POS.
 *
 * Risk levels:
 *   low      — metadata / copy fields (publicName, SEO, tags, comments)
 *   medium   — soft operational flags (isActive, validationStatus)
 *   high     — financial or stock figures (price, cost, stockQuantity)
 *   critical — reserved for future multi-store or wholesale price overrides
 *
 * High + critical operations are NEVER auto-applied regardless of settings.
 */
@Entity('airtable_operations')
@Index(['storeId', 'status'])
@Index(['entityType', 'entityId', 'status'])
@Index(['status', 'createdAt'])
@Index(['riskLevel', 'status'])
export class AirtableOperationEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** e.g. 'product' | 'store' | 'supplier' */
  @Column({ name: 'entity_type', type: 'varchar', length: 50 })
  entityType: string;

  @Column({ name: 'entity_id', type: 'uuid' })
  entityId: string;

  @Column({ name: 'store_id', type: 'uuid' })
  storeId: string;

  /** Which field on the POS entity is being proposed, e.g. 'priceMinorUnits' */
  @Column({ type: 'varchar', length: 100 })
  field: string;

  /**
   * Snapshot of the current POS value at the time the operation was created.
   * null when the field does not exist on the entity (new metadata fields).
   */
  @Column({ name: 'current_value', type: 'jsonb', nullable: true })
  currentValue: unknown | null;

  /** The value proposed by the Airtable operator */
  @Column({ name: 'proposed_value', type: 'jsonb' })
  proposedValue: unknown;

  @Column({ name: 'risk_level', type: 'varchar', length: 20 })
  riskLevel: AirtableRiskLevel;

  @Column({ type: 'varchar', length: 20, default: 'pending' })
  status: AirtableOperationStatus;

  /** Airtable record that triggered this operation */
  @Column({ name: 'source_airtable_record_id', type: 'varchar', length: 64 })
  sourceAirtableRecordId: string;

  @Column({ name: 'source_airtable_table_id', type: 'varchar', length: 64 })
  sourceAirtableTableId: string;

  /** Employee UUID who approved or rejected */
  @Column({ name: 'reviewed_by', type: 'uuid', nullable: true })
  reviewedBy: string | null;

  @Column({ name: 'reviewed_at', type: 'timestamp', nullable: true })
  reviewedAt: Date | null;

  @Column({ name: 'applied_at', type: 'timestamp', nullable: true })
  appliedAt: Date | null;

  /** Populated when status = 'failed' */
  @Column({ name: 'failure_reason', type: 'text', nullable: true })
  failureReason: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
