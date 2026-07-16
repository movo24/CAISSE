import { Entity, PrimaryGeneratedColumn, Column, Index, CreateDateColumn } from 'typeorm';

/** Galerie d'images produit — URLs externes uniquement (Lot 4). */
@Entity('product_media')
@Index(['productId'])
export class ProductMediaEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'product_id', type: 'uuid' })
  productId: string;

  @Column({ name: 'store_id', type: 'uuid' })
  storeId: string;

  @Column({ type: 'text' })
  url: string;

  /** Type d'image (M-C). Au plus un `main` par produit (index unique partiel). */
  @Column({ type: 'varchar', length: 12, default: 'other' })
  kind: 'main' | 'front' | 'back' | 'detail' | 'other';

  @Column({ name: 'sort_order', type: 'integer', default: 0 })
  sortOrder: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
