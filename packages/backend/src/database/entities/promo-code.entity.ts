import { Entity, PrimaryGeneratedColumn, Column, Index, CreateDateColumn, UpdateDateColumn } from 'typeorm';

/**
 * PromoCode (decision 6) — a SHARED, human-readable promo code ("SUMMER20").
 * Store-scoped, optional validity window and total usage cap, optional scope to a
 * product or category, active flag. Usage is logged (promo_code_redemptions) and
 * the applying employee is audited. Owner-defined (not seller-discretionary) — so
 * distinct from the 30% manual-discount cap (decision 5).
 */
@Entity('promo_codes')
@Index(['storeId', 'code'], { unique: true })
export class PromoCodeEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'store_id', type: 'uuid' })
  storeId: string;

  /** Human-readable, stored uppercased; unique per store. */
  @Column()
  code: string;

  @Column({ name: 'discount_type', type: 'varchar', length: 12 })
  discountType: 'percentage' | 'fixed';

  /** percentage → points (20 = 20%); fixed → minor units. */
  @Column({ name: 'discount_value', type: 'integer' })
  discountValue: number;

  @Column({ name: 'starts_at', type: 'timestamp', nullable: true })
  startsAt: Date | null;

  @Column({ name: 'ends_at', type: 'timestamp', nullable: true })
  endsAt: Date | null;

  /** Total redemptions allowed; null = unlimited. */
  @Column({ name: 'max_uses', type: 'integer', nullable: true })
  maxUses: number | null;

  @Column({ name: 'used_count', type: 'integer', default: 0 })
  usedCount: number;

  /** Optional scope — restrict the code to one product or one category. */
  @Column({ name: 'product_id', type: 'uuid', nullable: true })
  productId: string | null;

  @Column({ name: 'category_id', type: 'uuid', nullable: true })
  categoryId: string | null;

  @Column({ name: 'is_active', default: true })
  isActive: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
