import { Entity, PrimaryGeneratedColumn, Column, Index } from 'typeorm';

@Entity('product_categories')
@Index(['storeId'])
export class ProductCategoryEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  name: string;

  @Column({ name: 'parent_id', type: 'varchar', nullable: true })
  parentId: string | null;

  @Column({ name: 'store_id' })
  storeId: string;
}
