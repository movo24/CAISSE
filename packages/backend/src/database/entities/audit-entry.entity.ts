import { Entity, PrimaryGeneratedColumn, Column, Index } from 'typeorm';

@Entity('audit_entries')
@Index(['storeId', 'timestamp'])
export class AuditEntryEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'store_id' })
  storeId: string;

  @Column({ name: 'employee_id' })
  employeeId: string;

  @Column()
  action: string;

  @Column({ name: 'entity_type' })
  entityType: string;

  @Column({ name: 'entity_id' })
  entityId: string;

  @Column({ type: 'jsonb', default: '{}' })
  details: Record<string, unknown>;

  @Column({ name: 'previous_hash' })
  previousHash: string;

  @Column({ name: 'current_hash' })
  currentHash: string;

  @Column({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
  timestamp: Date;
}
