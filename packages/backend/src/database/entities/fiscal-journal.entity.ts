import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

/**
 * Fiscal journal — append-only, per-store, hash-chained log of fiscal events
 * that are NOT themselves sales (currently: voids / annulations).
 *
 * NF525 (M4): an annulation must be a chained, tamper-evident event in an
 * immutable journal, not merely a `sales.status = 'voided'` flip + an audit
 * line. This mirrors the sale / credit-note hash-chain pattern: each entry
 * stores `hashChainPrev` (the previous journal hash for the store, or genesis)
 * and `hashChainCurrent = sha256(prev + payload)`. Rows are never updated or
 * deleted.
 */
@Entity('fiscal_journal')
@Index(['storeId', 'createdAt'])
@Index(['refId'])
export class FiscalJournalEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'store_id' })
  storeId: string;

  /** Event kind. 'void' for now; extensible (e.g. 'correction'). */
  @Column({ name: 'event_type' })
  eventType: string;

  /** The entity this event refers to (e.g. the voided sale id). */
  @Column({ name: 'ref_id', type: 'uuid', nullable: true })
  refId: string | null;

  /** Human-facing reference (e.g. the voided sale's ticket number). */
  @Column({ name: 'ticket_number', type: 'varchar', nullable: true })
  ticketNumber: string | null;

  /**
   * Canonical JSON string of the event's fiscal fields, stored VERBATIM (text,
   * not jsonb) so it is hashed and re-verified byte-for-byte — jsonb would
   * reorder keys and break the chain on verification.
   */
  @Column({ name: 'payload', type: 'text' })
  payload: string;

  @Column({ name: 'hash_chain_prev', length: 64 })
  hashChainPrev: string;

  @Column({ name: 'hash_chain_current', length: 64 })
  hashChainCurrent: string;

  /**
   * Monotonic per-store cursor the journal chain heads on (ADR-012 layer 0) —
   * replaces `ORDER BY created_at` head-selection (wall-clock, fork-prone). The
   * Z-seal close-window borders the voids side on this. Nullable only in the
   * pre-backfill window; backfilled by chain walk, then assigned at insert.
   */
  @Column({ name: 'journal_seq', type: 'bigint', nullable: true })
  journalSeq: number | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
