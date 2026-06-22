import { Entity, PrimaryGeneratedColumn, Column, Index } from 'typeorm';

@Entity('audit_entries')
@Index(['storeId', 'timestamp'])
// M402 — anti-fork: within a store, no two entries may chain on the same parent
// hash. A concurrent collision now fails the INSERT (handled with a retry in
// AuditService.doLog) instead of silently forking the chain.
@Index('UX_audit_store_prevhash', ['storeId', 'previousHash'], { unique: true })
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

  /**
   * M402 — recompute-verifiability marker + the EXACT ISO timestamp that went into
   * the hash. NULL = legacy v1 row (its `details` were never covered by the hash and
   * the hashed instant was not persisted → only chain LINKAGE is verifiable). When
   * set (v2), `verifyChain` recomputes `currentHash` from the LIVE columns
   * (action/entityType/entityId/details canonicalised + this exact timestamp) and so
   * detects tampering of `details` — which the v1 hash silently ignored.
   */
  @Column({ name: 'hashed_at', type: 'varchar', nullable: true })
  hashedAt: string | null;

  @Column({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
  timestamp: Date;
}
