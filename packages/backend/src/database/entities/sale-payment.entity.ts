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

  @ManyToOne(() => SaleEntity, (s) => s.payments)
  @JoinColumn({ name: 'sale_id' })
  sale: SaleEntity;

  @ManyToOne(() => PaymentTerminalEntity, { nullable: true })
  @JoinColumn({ name: 'terminal_id' })
  terminal: PaymentTerminalEntity;
}
