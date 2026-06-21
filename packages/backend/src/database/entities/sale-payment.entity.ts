import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn, Index } from 'typeorm';
import { SaleEntity } from './sale.entity';
import { PaymentTerminalEntity } from './payment-terminal.entity';

@Entity('sale_payments')
@Index(['saleId'])
export class SalePaymentEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'sale_id' })
  saleId: string;

  @Column()
  method: string;

  @Column({ name: 'amount_minor_units', type: 'integer' })
  amountMinorUnits: number;

  @Column({ name: 'currency_code', default: 'EUR' })
  currencyCode: string;

  @Column({ type: 'varchar', nullable: true })
  reference: string;

  @Column({ name: 'stripe_payment_intent_id', type: 'varchar', nullable: true })
  stripePaymentIntentId: string | null;

  @Column({ name: 'stripe_reader_id', type: 'varchar', nullable: true })
  stripeReaderId: string | null;

  @Column({ name: 'terminal_id', type: 'varchar', nullable: true })
  terminalId: string | null;

  /**
   * Whether this leg is REALLY captured (decision 6). Cash is captured on hand;
   * a card leg awaiting real capture is captured=false → the sale is
   * payment_pending and never counts as paid until regularised.
   */
  @Column({ type: 'boolean', default: true })
  captured: boolean;

  @Column({ name: 'captured_at', type: 'timestamp', nullable: true })
  capturedAt: Date | null;

  @ManyToOne(() => SaleEntity, (s) => s.payments)
  @JoinColumn({ name: 'sale_id' })
  sale: SaleEntity;

  @ManyToOne(() => PaymentTerminalEntity, { nullable: true })
  @JoinColumn({ name: 'terminal_id' })
  terminal: PaymentTerminalEntity;
}
