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
// Per-store monotonic fiscal cursor. PARTIAL unique (sale_seq IS NOT NULL) so
// offline-synced sales (client ticket numbers, no seq) don't collide on NULL,
// while the online hash chain stays gap-checkable. Declared here so
// synchronize-based test DBs (pg-mem) build it; mirrored in migration 1720 for
// prod. See uq_sales_store_sale_seq.
@Index(['storeId', 'saleSeq'], { unique: true, where: '"sale_seq" IS NOT NULL' })
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

  /**
   * Per-store monotonic sequence — the AUTHORITATIVE fiscal cursor (ADR-012).
   * `ticket_number` is a zero-padded display string; ordering the hash chain by
   * it is lexical, which diverges from numeric at the 6-digit boundary
   * (`T-1000000` < `T-999999` as text → dup tickets + chain fork). This integer
   * column is what the generator and the hash-chain head are ordered by, so the
   * chain stays correct past 1,000,000 sales. Nullable: offline-synced sales
   * carry a client ticket number and no seq (excluded from the chain head via
   * `sale_seq IS NOT NULL`). Explicit `type` per the TypeORM nullable-union rule.
   */
  @Column({ name: 'sale_seq', type: 'bigint', nullable: true })
  saleSeq: number | null;

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

  /**
   * P312 — TD-017-SESSION-LINK: the POS session this sale was made in
   * (migration 1726, nullable — NULL for pre-link sales or terminals without
   * an open session). NOT part of the fiscal fingerprint (metadata link only).
   */
  @Column({ name: 'pos_session_id', type: 'uuid', nullable: true })
  posSessionId: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @Column({ name: 'completed_at', nullable: true })
  completedAt: Date;

  @OneToMany(() => SaleLineItemEntity, (li) => li.sale, { cascade: true, eager: true })
  lineItems: SaleLineItemEntity[];

  @OneToMany(() => SalePaymentEntity, (p) => p.sale, { cascade: true, eager: true })
  payments: SalePaymentEntity[];
}
