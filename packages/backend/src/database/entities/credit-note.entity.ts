import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  OneToMany,
  Index,
} from 'typeorm';
import { CreditNoteLineEntity } from './credit-note-line.entity';

/**
 * Credit note (avoir) — the immutable record of a return against a validated sale.
 *
 * NF525: a validated sale is NEVER modified. A return is an append-only event with
 * its own per-store hash chain (mirrors sale.entity) AND an audit_entries log line.
 *
 * type:
 *   - 'refund'       → money given back (cash/card); not reusable.
 *   - 'store_credit' → reusable avoir; `remainingMinorUnits` decremented on use.
 */
@Entity('credit_notes')
@Index(['storeId', 'createdAt'])
@Index(['originalSaleId'])
@Index(['code'], { unique: true })
export class CreditNoteEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ length: 20 })
  code: string;

  @Column({ name: 'store_id' })
  storeId: string;

  @Column({ name: 'original_sale_id', type: 'uuid', nullable: true })
  originalSaleId: string | null;

  /** 'return' (issued from a return) or 'gift_card' (sold/loaded as a gift card). */
  @Column({ default: 'return' })
  origin: 'return' | 'gift_card';

  @Column({ name: 'original_ticket_number', type: 'varchar', nullable: true })
  originalTicketNumber: string | null;

  @Column()
  type: 'refund' | 'store_credit';

  @Column({ name: 'refund_method', type: 'varchar', nullable: true })
  refundMethod: string | null;

  @Column({ default: 'active' })
  status: 'active' | 'partially_redeemed' | 'redeemed' | 'refunded' | 'cancelled';

  @Column({ type: 'text', nullable: true })
  reason: string | null;

  @Column({ name: 'employee_id' })
  employeeId: string;

  /**
   * POS cash session (pos_sessions.id) this return was rung under, resolved
   * SERVER-SIDE from the terminal's ACTIVE session at creation — never declared
   * by the client. Nullable & additive: legacy avoirs and paths without a
   * resolvable session (offline replay after the session closed) carry null —
   * an auditable "session unknown". DELIBERATELY OUTSIDE the credit-note hash
   * payload ({code, storeId, originalSaleId, total, lines}) so no existing
   * avoir is rehashed. Cash refunds bound here are deducted from the session's
   * expected cash at close.
   */
  @Column({ name: 'session_id', type: 'uuid', nullable: true })
  sessionId: string | null;

  /** Physical terminal (X-Terminal-Id) the return was rung on. Same rationale. */
  @Column({ name: 'terminal_id', type: 'varchar', nullable: true })
  terminalId: string | null;

  @Column({ name: 'employee_name_snapshot', type: 'varchar', nullable: true })
  employeeNameSnapshot: string | null;

  @Column({ name: 'total_minor_units', type: 'integer' })
  totalMinorUnits: number;

  /** For store_credit: remaining spendable balance. For refund: 0. */
  @Column({ name: 'remaining_minor_units', type: 'integer', default: 0 })
  remainingMinorUnits: number;

  @Column({ name: 'currency_code', default: 'EUR' })
  currencyCode: string;

  @Column({ name: 'hash_chain_prev', type: 'varchar', nullable: true })
  hashChainPrev: string | null;

  @Column({ name: 'hash_chain_current', type: 'varchar', nullable: true })
  hashChainCurrent: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @OneToMany(() => CreditNoteLineEntity, (l) => l.creditNote, { cascade: true, eager: true })
  lines: CreditNoteLineEntity[];
}
