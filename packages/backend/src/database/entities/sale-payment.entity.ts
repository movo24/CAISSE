import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn, Index } from 'typeorm';
import { SaleEntity } from './sale.entity';

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

  @Column({ nullable: true })
  reference: string;

  @ManyToOne(() => SaleEntity, (s) => s.payments)
  @JoinColumn({ name: 'sale_id' })
  sale: SaleEntity;
}
