import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

export type CouponType = 'WELCOME' | 'LOYALTY' | 'MANUAL' | 'CAMPAIGN';
export type CouponStatus =
  | 'AVAILABLE'
  | 'LOCKED'
  | 'USED'
  | 'EXPIRED'
  | 'CANCELLED';

@Entity('coupons')
@Index(['customerId', 'status'])
@Index(['status'])
export class CouponEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'customer_id' })
  customerId: string;

  @Column({ length: 20 })
  type: CouponType;

  @Column({ name: 'discount_type', length: 20, default: 'PERCENT' })
  discountType: 'PERCENT';

  @Column({ name: 'discount_value', type: 'int' })
  discountValue: number;

  @Column({ length: 20, default: 'AVAILABLE' })
  status: CouponStatus;

  @Column({ name: 'valid_from', type: 'timestamp' })
  validFrom: Date;

  @Column({ name: 'valid_until', type: 'timestamp', nullable: true })
  validUntil: Date | null;

  @Column({ name: 'locked_at', type: 'timestamp', nullable: true })
  lockedAt: Date | null;

  @Column({
    name: 'locked_by_idempotency_key',
    type: 'varchar',
    length: 64,
    nullable: true,
  })
  lockedByIdempotencyKey: string | null;

  @Column({ name: 'used_at', type: 'timestamp', nullable: true })
  usedAt: Date | null;

  @Column({ name: 'used_ticket_id', type: 'uuid', nullable: true })
  usedTicketId: string | null;

  @Column({ name: 'used_store_id', type: 'uuid', nullable: true })
  usedStoreId: string | null;

  @Column({ name: 'used_terminal_id', type: 'uuid', nullable: true })
  usedTerminalId: string | null;

  @Column({
    name: 'visit_rank_when_emitted',
    type: 'int',
    nullable: true,
  })
  visitRankWhenEmitted: number | null;

  @Column({ name: 'cycle_id', type: 'uuid', nullable: true })
  cycleId: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
