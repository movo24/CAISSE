import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from 'typeorm';

/** Records each time a store-credit avoir is spent on a new sale (traceability). */
@Entity('credit_note_redemptions')
@Index(['creditNoteId'])
@Index(['saleId'])
export class CreditNoteRedemptionEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'credit_note_id', type: 'uuid' })
  creditNoteId: string;

  @Column({ name: 'sale_id', type: 'uuid' })
  saleId: string;

  @Column({ name: 'store_id' })
  storeId: string;

  @Column({ name: 'amount_minor_units', type: 'integer' })
  amountMinorUnits: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
