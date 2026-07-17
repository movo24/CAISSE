import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn, Index } from 'typeorm';
import { CreditNoteEntity } from './credit-note.entity';
import { decimalToNumber } from '../transformers/decimal-to-number.transformer';

/** A single returned line within a credit note (supports partial returns). */
@Entity('credit_note_lines')
@Index(['creditNoteId'])
export class CreditNoteLineEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'credit_note_id', type: 'uuid' })
  creditNoteId: string;

  /** The original sale_line_items.id this return came from (for returned-qty tracking). */
  @Column({ name: 'original_line_item_id', type: 'uuid', nullable: true })
  originalLineItemId: string | null;

  @Column({ name: 'product_id' })
  productId: string;

  @Column({ name: 'product_name', type: 'varchar', nullable: true })
  productName: string | null;

  @Column({ type: 'varchar', nullable: true })
  ean: string | null;

  @Column({ type: 'integer' })
  quantity: number;

  @Column({ name: 'unit_price_minor_units', type: 'integer' })
  unitPriceMinorUnits: number;

  @Column({ name: 'line_total_minor_units', type: 'integer' })
  lineTotalMinorUnits: number;

  @Column({ name: 'tax_rate', type: 'decimal', default: 20, transformer: decimalToNumber })
  taxRate: number;

  @ManyToOne(() => CreditNoteEntity, (cn) => cn.lines)
  @JoinColumn({ name: 'credit_note_id' })
  creditNote: CreditNoteEntity;
}
