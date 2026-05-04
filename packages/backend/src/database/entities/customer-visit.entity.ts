import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

@Entity('customer_visits')
@Index(['customerId'])
@Index(['storeId'])
export class CustomerVisitEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'customer_id' })
  customerId: string;

  @Column({ name: 'store_id' })
  storeId: string;

  @Column({ name: 'terminal_id', type: 'uuid', nullable: true })
  terminalId: string | null;

  @Column({ name: 'cashier_employee_id', type: 'uuid', nullable: true })
  cashierEmployeeId: string | null;

  @Column({ name: 'ticket_id', type: 'uuid', nullable: true })
  ticketId: string | null;

  @Column({ name: 'purchase_amount_cents', type: 'int', nullable: true })
  purchaseAmountCents: number | null;

  @Column({ name: 'coupon_used_id', type: 'uuid', nullable: true })
  couponUsedId: string | null;

  @Column({ length: 20, default: 'POS_SCAN' })
  source: string;

  @CreateDateColumn({ name: 'visited_at' })
  visitedAt: Date;
}
