import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from 'typeorm';

/**
 * Journal d'audit des DROITS — immuable, hash-chaîné (miroir du module `audit`).
 *
 * Append-only : jamais d'UPDATE/DELETE. Chaîne SHA-256 via `computeAuditHashV2`
 * (réutilisé). L'index unique `(scope, previous_hash)` empêche les forks (retry sur
 * conflit). `hashed_at` = instant EXACT haché → verifyChain recompute depuis les
 * colonnes vivantes et détecte toute altération (valeurs OU ré-attribution d'acteur).
 *
 * Mapping `name:` explicite (pas de SnakeNamingStrategy).
 */
@Entity('access_audit_log')
@Index('idx_aal_scope_occurred', ['scope', 'occurredAt'])
@Index('UX_access_scope_prevhash', ['scope', 'previousHash'], { unique: true })
export class AccessAuditLogEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** Partition de chaîne (un seul journal global des droits par défaut : 'global'). */
  @Column({ name: 'scope', type: 'varchar', length: 64, default: 'global' })
  scope: string;

  @Column({ name: 'actor_employee_id', type: 'varchar' })
  actorEmployeeId: string;

  @Column({ name: 'actor_user_id', type: 'varchar', nullable: true })
  actorUserId: string | null;

  @Column({ name: 'target_employee_id', type: 'varchar', nullable: true })
  targetEmployeeId: string | null;

  @Column({ name: 'event_type', type: 'varchar', length: 40 })
  eventType: string;

  @Column({ name: 'store_id', type: 'varchar', nullable: true })
  storeId: string | null;

  @Column({ name: 'previous_value', type: 'jsonb', nullable: true })
  previousValue: Record<string, unknown> | null;

  @Column({ name: 'new_value', type: 'jsonb', nullable: true })
  newValue: Record<string, unknown> | null;

  @Column({ name: 'reason', type: 'text', nullable: true })
  reason: string | null;

  @Column({ name: 'ip_address', type: 'varchar', nullable: true })
  ipAddress: string | null;

  @Column({ name: 'session_id', type: 'varchar', nullable: true })
  sessionId: string | null;

  // --- Chaîne de hash ---
  @Column({ name: 'previous_hash', type: 'varchar' })
  previousHash: string;

  @Column({ name: 'hash', type: 'varchar' })
  hash: string;

  /** Instant ISO EXACT haché (recompute-verifiable). */
  @Column({ name: 'hashed_at', type: 'varchar' })
  hashedAt: string;

  @CreateDateColumn({ name: 'occurred_at' })
  occurredAt: Date;
}
