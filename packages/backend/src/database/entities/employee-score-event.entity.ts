import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

/**
 * Employee score event — un fait POS probant, signé techniquement.
 *
 * INVARIANT MÉTIER : chaque événement porte employee_id + store_id, et pour les
 * actions caisse également terminal_id + session_id. Un fait sans ces champs est
 * une anomalie (event_type ACTION_WITHOUT_VALID_SESSION). Ce ledger est la seule
 * source du score ; il est recomputable et n'altère jamais la chaîne d'audit.
 */
@Entity('employee_score_events')
@Index(['employeeId', 'createdAt'])
@Index(['storeId', 'createdAt'])
@Index(['employeeId', 'eventType', 'createdAt'])
export class EmployeeScoreEventEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'employee_id' })
  employeeId: string;

  @Column({ name: 'store_id' })
  storeId: string;

  @Column({ name: 'terminal_id', type: 'varchar', nullable: true })
  terminalId: string | null;

  @Column({ name: 'session_id', type: 'uuid', nullable: true })
  sessionId: string | null;

  @Column({ name: 'event_type' })
  eventType: string;

  @Column({ type: 'varchar', default: 'info' })
  category: string;

  @Column({ type: 'varchar', default: 'info' })
  severity: string;

  /** Points appliqués au score (négatif = pénalité). Résolu depuis la règle. */
  @Column({ name: 'points_delta', type: 'integer', default: 0 })
  pointsDelta: number;

  @Column({ type: 'varchar', nullable: true })
  reason: string | null;

  @Column({ name: 'metadata_json', type: 'jsonb', nullable: true })
  metadata: Record<string, unknown> | null;

  /** Qui a produit le fait techniquement (employé connecté / système / manager). */
  @Column({ name: 'created_by', type: 'varchar', nullable: true })
  createdBy: string | null;

  /** Provenance : pos | dashboard | inventory | mobile | system. */
  @Column({ type: 'varchar', default: 'pos' })
  source: string;

  /** Version des règles ayant produit points_delta (traçabilité). */
  @Column({ name: 'rule_version', type: 'integer', default: 1 })
  ruleVersion: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
