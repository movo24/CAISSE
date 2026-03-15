import { Entity, PrimaryGeneratedColumn, Column, Index } from 'typeorm';

@Entity('product_categories')
@Index(['storeId'])
export class ProductCategoryEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  name: string;

  @Column({ name: 'parent_id', nullable: true })
  parentId: string;

  @Column({ name: 'store_id' })
  storeId: string;
}
