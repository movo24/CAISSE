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

  /**
   * POS cash session (pos_sessions.id) this sale was rung under, resolved
   * server-side from the terminal's ACTIVE session at creation — NOT declared by
   * the client. Nullable & additive: legacy sales and paths without a resolvable
   * session (offline replay, by-ticket) carry null — an auditable "session
   * unknown", never a fabricated binding. DELIBERATELY OUTSIDE the fiscal hash
   * fingerprint (v1/v2), so existing validated tickets stay valid and no row is
   * ever rehashed.
   */
  @Column({ name: 'session_id', type: 'uuid', nullable: true })
  sessionId: string | null;

  /**
   * Physical terminal (X-Terminal-Id) the sale was rung on — technical
   * signature of the register. Nullable/additive, same rationale as sessionId.
   */
  @Column({ name: 'terminal_id', type: 'varchar', nullable: true })
  terminalId: string | null;

  @Column({ default: 'pending' })
  status: string;

  @Column({ name: 'subtotal_minor_units', type: 'integer', default: 0 })
  subtotalMinorUnits: number;

  @Column({ name: 'discount_total_minor_units', type: 'integer', default: 0 })
  discountTotalMinorUnits: number;

  /** Manager/admin who authorised a manual discount on this sale (decision 5). */
  @Column({ name: 'discount_approver_id', type: 'uuid', nullable: true })
  discountApproverId: string | null;

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
