import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

/**
 * Stores the mapping between a local POS entity (product, store, …) and its
 * corresponding Airtable record ID.
 *
 * Unique on (localEntityType, localEntityId, airtableTableId) so a single
 * entity can be linked to one record per Airtable table.
 */
@Entity('airtable_linked_records')
@Index(['localEntityType', 'localEntityId', 'airtableTableId'], { unique: true })
@Index(['storeId', 'localEntityType'])
export class AirtableLinkedRecordEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** e.g. 'product' | 'store' | 'supplier' */
  @Column({ name: 'local_entity_type', type: 'varchar', length: 50 })
  localEntityType: string;

  @Column({ name: 'local_entity_id', type: 'uuid' })
  localEntityId: string;

  /** Airtable table identifier, e.g. 'tblXXXXXXXXXXXXXX' */
  @Column({ name: 'airtable_table_id', type: 'varchar', length: 64 })
  airtableTableId: string;

  /** Airtable record ID, e.g. 'recXXXXXXXXXXXXXX' */
  @Column({ name: 'airtable_record_id', type: 'varchar', length: 64 })
  airtableRecordId: string;

  @Column({ name: 'store_id', type: 'uuid' })
  storeId: string;

  /** Timestamp of the last successful sync (export or import) for this record */
  @Column({ name: 'last_synced_at', type: 'timestamp', nullable: true })
  lastSyncedAt: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
