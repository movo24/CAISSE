import { Entity, PrimaryGeneratedColumn, Column, Index, CreateDateColumn } from 'typeorm';

/** Produits liés : complémentaires, ventes croisées, substitution (Lot E). */
@Entity('product_links')
@Index(['productId'])
export class ProductLinkEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'product_id', type: 'uuid' })
  productId: string;

  @Column({ name: 'store_id', type: 'uuid' })
  storeId: string;

  @Column({ name: 'linked_product_id', type: 'uuid' })
  linkedProductId: string;

  @Column({ name: 'link_type', type: 'varchar', length: 16, default: 'complementary' })
  linkType: 'complementary' | 'cross_sell' | 'substitute';

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
