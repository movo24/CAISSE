import { Entity, PrimaryGeneratedColumn, Column, Index, CreateDateColumn } from 'typeorm';

/** Journal append-only des modifications de la fiche produit (Lot D). */
@Entity('product_change_log')
@Index(['productId', 'createdAt'])
export class ProductChangeLogEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'product_id', type: 'uuid' })
  productId: string;

  @Column({ name: 'store_id', type: 'uuid' })
  storeId: string;

  @Column({ type: 'varchar', length: 60 })
  field: string;

  @Column({ name: 'old_value', type: 'text', nullable: true })
  oldValue: string | null;

  @Column({ name: 'new_value', type: 'text', nullable: true })
  newValue: string | null;

  @Column({ name: 'changed_by', type: 'varchar', nullable: true })
  changedBy: string | null;

  @Column({ name: 'changed_by_role', type: 'varchar', nullable: true })
  changedByRole: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
