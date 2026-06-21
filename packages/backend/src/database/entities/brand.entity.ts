import { Entity, PrimaryGeneratedColumn, Column, Index, CreateDateColumn } from 'typeorm';

/**
 * Brand — catalog reference data (store-scoped, like product_categories). Linked
 * from products via product.brand_id. Drives back-office filtering and product /
 * margin analysis by brand.
 */
@Entity('brands')
@Index(['storeId', 'name'], { unique: true })
export class BrandEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  name: string;

  @Column({ name: 'store_id', type: 'uuid' })
  storeId: string;

  @Column({ name: 'is_active', default: true })
  isActive: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
