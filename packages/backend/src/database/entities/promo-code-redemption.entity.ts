import { Entity, PrimaryGeneratedColumn, Column, Index, CreateDateColumn } from 'typeorm';

/** Usage history for a promo code (decision 6): who applied it, when, where. */
@Entity('promo_code_redemptions')
@Index(['promoCodeId'])
export class PromoCodeRedemptionEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'promo_code_id', type: 'uuid' })
  promoCodeId: string;

  @Column({ name: 'store_id', type: 'uuid' })
  storeId: string;

  @Column({ name: 'employee_id', type: 'uuid' })
  employeeId: string;

  @Column({ name: 'sale_id', type: 'uuid', nullable: true })
  saleId: string | null;

  @Column({ name: 'discount_applied_minor_units', type: 'integer', nullable: true })
  discountAppliedMinorUnits: number | null;

  @CreateDateColumn({ name: 'applied_at' })
  appliedAt: Date;
}
