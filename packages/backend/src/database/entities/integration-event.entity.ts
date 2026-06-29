import { Entity, PrimaryColumn, Column, Index, CreateDateColumn } from 'typeorm';

/**
 * Integration outbox (append-only for business fields).
 *
 * The durable, normalized stream POS Caisse emits for Comptamax24, TimeWin24 and
 * (future) Analytik R. Written inside the aggregate's transaction (transactional
 * outbox) so it is consistent with the sale/refund/session it describes; relayed
 * out-of-band so the caisse never blocks on a consumer.
 *
 * Business fields (type, payload, tenant, occurredAt…) are NEVER updated.
 * Only delivery metadata (status, publishedAt, attempts) may change.
 */
@Entity('integration_events')
@Index(['status', 'createdAt']) // relay polling
@Index(['aggregateType', 'aggregateId'])
@Index(['storeId', 'occurredAt'])
export class IntegrationEventEntity {
  @PrimaryColumn({ type: 'uuid' })
  id: string;

  @Column({ name: 'type', type: 'varchar' })
  type: string;

  @Column({ name: 'aggregate_type', type: 'varchar' })
  aggregateType: string;

  @Column({ name: 'aggregate_id', type: 'varchar' })
  aggregateId: string;

  @Column({ name: 'store_id', type: 'varchar' })
  storeId: string;

  @Column({ name: 'organization_id', type: 'varchar', nullable: true })
  organizationId: string | null;

  @Column({ name: 'terminal_id', type: 'varchar', nullable: true })
  terminalId: string | null;

  @Column({ name: 'employee_id', type: 'varchar', nullable: true })
  employeeId: string | null;

  @Column({ name: 'actor_role', type: 'varchar', nullable: true })
  actorRole: string | null;

  @Column({ name: 'occurred_at', type: 'timestamptz' })
  occurredAt: Date;

  @Column({ name: 'payload', type: 'jsonb', default: '{}' })
  payload: Record<string, unknown>;

  @Column({ name: 'schema_version', type: 'integer', default: 1 })
  schemaVersion: number;

  @Column({ name: 'source', type: 'varchar', default: 'pos-caisse' })
  source: string;

  // ── delivery metadata (mutable, NOT a fiscal record) ──
  @Column({ name: 'status', type: 'varchar', default: 'pending' })
  status: string;

  @Column({ name: 'published_at', type: 'timestamptz', nullable: true })
  publishedAt: Date | null;

  @Column({ name: 'attempts', type: 'integer', default: 0 })
  attempts: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
