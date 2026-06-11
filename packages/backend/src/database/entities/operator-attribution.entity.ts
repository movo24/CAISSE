import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

/**
 * Operator attribution — (1b) binding, option (i), side-table form.
 *
 * NON-AUTHORITATIVE, NON-FISCAL observation of "which operator the active
 * session attributes an event to", kept STRUCTURALLY off the three hashed
 * fiscal tables (sales, credit_notes, fiscal_journal). Those tables do not
 * change at all — the cleanest guarantee on the append-only journal.
 *
 * Why a side-table beats annotation columns:
 *   - Non-authority is STRUCTURAL, not asserted-and-proven-by-test: this
 *     data is simply not on the hashed tables. An auditor sees a separate,
 *     manifestly non-fiscal table.
 *   - fiscal_journal (the most sacred, append-only) is untouched.
 *   - The v3 bascule migrates attribution INTO the chain from a clean
 *     table, with no orphan columns left on the fiscal tables.
 *
 * Insert-only: observing an append-only event is itself append-only. Never
 * UPDATE a row here. Written in the SAME transaction as its event.
 *
 * The authoritative operator stays the JWT value on the event's own
 * employee_id (sales.employee_id, hashed; voidPayload.employee_id, hashed;
 * credit_notes.employee_id, exported). Divergence = authoritative vs
 * session_operator_id, computed by join on (event_type, event_id). No extra
 * field needed; both values already exist (one here, one on the event).
 *
 * v3-decision metric (define before flipping): converge always → session
 * adds nothing fiscal, v3 unneeded; diverge → measures the real attribution
 * gap before graving it into the chain. The v3 bascule (operator into the
 * hash, gated on a per-terminal device credential) is a separate, future,
 * gated fiscal decision.
 */
@Entity('operator_attribution')
@Index(['eventType', 'eventId'], { unique: true })
@Index(['storeId', 'attributionSource'])
export class OperatorAttributionEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** 'sale' | 'void' | 'return' — the fiscal door this attribution observes. */
  @Column({ name: 'event_type' })
  eventType: string;

  /**
   * The id of the observed event: sales.id, fiscal_journal.id (for a void),
   * or credit_notes.id (for a return). Referent, not a FK (kept decoupled
   * from the fiscal tables on purpose).
   */
  @Column({ name: 'event_id', type: 'uuid' })
  eventId: string;

  @Column({ name: 'store_id' })
  storeId: string;

  /**
   * The employee the active terminal session attributes the event to.
   * Null when no active session was found for the terminal (the gap is
   * recorded in data, never blocks the sale).
   */
  @Column({ name: 'session_operator_id', type: 'varchar', nullable: true })
  sessionOperatorId: string | null;

  /** The terminal whose session was consulted (from X-Terminal-Id). */
  @Column({ name: 'session_terminal_id', type: 'varchar', nullable: true })
  sessionTerminalId: string | null;

  /** 'session' (a session was found) | 'no_session' (gap recorded). */
  @Column({ name: 'attribution_source' })
  attributionSource: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
