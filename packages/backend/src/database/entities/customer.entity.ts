import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

@Entity('customers')
@Index(['storeId'])
@Index(['qrCode'])
@Index(['storeId', 'updatedAt'])
export class CustomerEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'first_name' })
  firstName: string;

  @Column({ name: 'last_name' })
  lastName: string;

  @Column({ nullable: true })
  phone: string;

  @Column({ nullable: true })
  email: string;

  @Column({ name: 'qr_code', unique: true })
  qrCode: string;

  @Column({ name: 'loyalty_points', type: 'integer', default: 0 })
  loyaltyPoints: number;

  @Column({ name: 'is_first_purchase', default: true })
  isFirstPurchase: boolean;

  @Column({ name: 'is_verified', default: false })
  isVerified: boolean;

  @Column({ name: 'store_id', type: 'uuid', nullable: true })
  storeId: string | null;

  // ── Wesley Club extensions ─────────────────────────────────
  @Column({ name: 'password_hash', type: 'varchar', length: 100, nullable: true })
  passwordHash: string | null;

  @Column({ name: 'preferred_store_id', type: 'uuid', nullable: true })
  preferredStoreId: string | null;

  @Column({ name: 'visit_count', type: 'int', default: 0 })
  visitCount: number;

  @Column({ name: 'last_visit_at', type: 'timestamp', nullable: true })
  lastVisitAt: Date | null;

  @Column({ name: 'deleted_at', type: 'timestamp', nullable: true })
  deletedAt: Date | null;

  @Column({ name: 'anonymized_at', type: 'timestamp', nullable: true })
  anonymizedAt: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
