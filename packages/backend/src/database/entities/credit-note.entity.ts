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

  @Column({ name: 'original_sale_id', type: 'uuid' })
  originalSaleId: string;

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
