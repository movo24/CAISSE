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

  /** Snapshot: employee name at time of sale (immutable history) */
  @Column({ name: 'employee_name_snapshot', nullable: true })
  employeeNameSnapshot: string;

  /** Snapshot: employee role at time of sale */
  @Column({ name: 'employee_role_snapshot', nullable: true })
  employeeRoleSnapshot: string;

  /** Snapshot: max discount at time of sale */
  @Column({ name: 'employee_max_discount_snapshot', type: 'decimal', nullable: true })
  employeeMaxDiscountSnapshot: number;

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

  // (H4) NOT NULL — a sale row in the canonical table can never be unsealed.
  // createSale always sets these (genesis hash for the first sale, the prior
  // current otherwise). The nullable columns were the structural ENABLER of
  // the offline raw-save fork; making them NOT NULL makes the unsealed state
  // non-representable, the same discipline as the partial-unique-index and the
  // attribution side-table — forbid the bad state at the schema level.
  @Column({ name: 'hash_chain_prev' })
  hashChainPrev: string;

  @Column({ name: 'hash_chain_current' })
  hashChainCurrent: string;

  /**
   * Hash-chain fingerprint version. 1 = legacy (ticketNumber, storeId,
   * employeeId, total, items only). 2 = full fiscal binding (adds TVA, remise,
   * subtotal, payments, horodatage, client). Recorded so a verifier picks the
   * right formula; existing v1 rows are never rehashed.
   */
  @Column({ name: 'hash_version', type: 'smallint', default: 1 })
  hashVersion: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @Column({ name: 'completed_at', nullable: true })
  completedAt: Date;

  @OneToMany(() => SaleLineItemEntity, (li) => li.sale, { cascade: true, eager: true })
  lineItems: SaleLineItemEntity[];

  @OneToMany(() => SalePaymentEntity, (p) => p.sale, { cascade: true, eager: true })
  payments: SalePaymentEntity[];
}
