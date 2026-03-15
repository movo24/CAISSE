import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from 'typeorm';

@Entity('price_history')
@Index(['productId', 'changedAt'])
export class PriceHistoryEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'product_id' })
  productId: string;

  @Column({ name: 'old_price_minor_units', type: 'integer' })
  oldPriceMinorUnits: number;

  @Column({ name: 'new_price_minor_units', type: 'integer' })
  newPriceMinorUnits: number;

  @Column({ name: 'changed_by' })
  changedBy: string;

  @Column({ nullable: true })
  reason: string;

  @CreateDateColumn({ name: 'changed_at' })
  changedAt: Date;
}
