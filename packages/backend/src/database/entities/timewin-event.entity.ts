import { Entity, PrimaryGeneratedColumn, Column, Index, CreateDateColumn } from 'typeorm';

/**
 * TimeWin24 event outbox — idempotency ledger for POS → TimeWin24 events.
 *
 * Decision: TimeWin24 events must NEVER be duplicated (session.opened/closed once,
 * retries resume cleanly). Each event carries a stable idempotency key; this table
 * is the prevent-at-write guard: a UNIQUE(idempotency_key) + claim-before-send means
 * a re-tick cannot resend an already-sent event, and a failed send can be retried.
 */
@Entity('timewin_events')
export class TimewinEventEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** Stable per-event key, e.g. 'session.opened:<sessionId>'. */
  @Column({ name: 'idempotency_key', type: 'varchar', length: 200 })
  @Index({ unique: true })
  idempotencyKey: string;

  @Column({ name: 'event_type', type: 'varchar', length: 50 })
  eventType: string;

  @Column({ name: 'store_id', type: 'uuid' })
  storeId: string;

  @Column({ name: 'employee_id', type: 'uuid', nullable: true })
  employeeId: string | null;

  /** pending → first claim; sent → acknowledged by TW24; failed → retriable. */
  @Column({ type: 'varchar', length: 20, default: 'pending' })
  status: 'pending' | 'sent' | 'failed';

  @Column({ type: 'integer', default: 0 })
  attempts: number;

  @Column({ name: 'last_error', type: 'varchar', length: 500, nullable: true })
  lastError: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @Column({ name: 'sent_at', type: 'timestamp', nullable: true })
  sentAt: Date | null;
}
