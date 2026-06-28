import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from 'typeorm';

@Entity('promo_rules')
@Index(['storeId', 'isActive'])
export class PromoRuleEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  name: string;

  @Column()
  type: string;

  @Column({ name: 'store_id' })
  storeId: string;

  @Column({ name: 'buy_quantity', type: 'integer', nullable: true })
  buyQuantity: number;

  @Column({ name: 'discount_percent', type: 'decimal', nullable: true })
  discountPercent: number;

  @Column({ name: 'discount_fixed_minor_units', type: 'integer', nullable: true })
  discountFixedMinorUnits: number;

  @Column({ name: 'applicable_product_ids', type: 'jsonb', default: '[]' })
  applicableProductIds: string[];

  @Column({ name: 'applicable_category_ids', type: 'jsonb', default: '[]' })
  applicableCategoryIds: string[];

  @Column({ name: 'start_date', type: 'timestamp' })
  startDate: Date;

  @Column({ name: 'end_date', type: 'timestamp', nullable: true })
  endDate: Date;

  @Column({ name: 'is_active', default: true })
  isActive: boolean;

  /**
   * POS-073 — usage cap. `usageLimit` null = unlimited. `usageCount` increments on
   * each application (increment wiring is a follow-up; the exclusion filter is enforced
   * in getActivePromos). Explicit type required by the TypeORM nullable-union rule.
   */
  @Column({ name: 'usage_limit', type: 'integer', nullable: true })
  usageLimit: number | null;

  @Column({ name: 'usage_count', type: 'integer', default: 0 })
  usageCount: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
