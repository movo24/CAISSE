import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  OneToMany,
  Index,
} from 'typeorm';
import { SaleLineItemEntity } from './sale-line-item.entity';
import { SalePaymentEntity } from './sale-payment.entity';

@Entity('sales')
@Index(['storeId'])
@Index(['storeId', 'createdAt'])
@Index(['storeId', 'status', 'completedAt'])
@Index(['customerId'])
@Index(['ticketNumber', 'storeId'], { unique: true })
export class SaleEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'store_id' })
  storeId: string;

  @Column({ name: 'employee_id' })
  employeeId: string;

  @Column({ name: 'customer_id', nullable: true })
  customerId: string;

  @Column({ default: 'pending' })
  status: string;

  @Column({ name: 'subtotal_minor_units', type: 'integer', default: 0 })
  subtotalMinorUnits: number;

  @Column({ name: 'discount_total_minor_units', type: 'integer', default: 0 })
  discountTotalMinorUnits: number;

  @Column({ name: 'tax_total_minor_units', type: 'integer', default: 0 })
  taxTotalMinorUnits: number;

  @Column({ name: 'total_minor_units', type: 'integer', default: 0 })
  totalMinorUnits: number;

  @Column({ name: 'currency_code', default: 'EUR' })
  currencyCode: string;

  @Column({ name: 'ticket_number' })
  ticketNumber: string;

  @Column({ name: 'hash_chain_prev', nullable: true })
  hashChainPrev: string;

  @Column({ name: 'hash_chain_current', nullable: true })
  hashChainCurrent: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @Column({ name: 'completed_at', nullable: true })
  completedAt: Date;

  @OneToMany(() => SaleLineItemEntity, (li) => li.sale, { cascade: true, eager: true })
  lineItems: SaleLineItemEntity[];

  @OneToMany(() => SalePaymentEntity, (p) => p.sale, { cascade: true, eager: true })
  payments: SalePaymentEntity[];
}
