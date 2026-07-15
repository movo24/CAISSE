import { Entity, PrimaryGeneratedColumn, Column, Index, CreateDateColumn } from 'typeorm';

/** Documents produit (notices, fiches, certificats) — URLs externes (Lot 4). */
@Entity('product_documents')
@Index(['productId'])
export class ProductDocumentEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'product_id', type: 'uuid' })
  productId: string;

  @Column({ name: 'store_id', type: 'uuid' })
  storeId: string;

  @Column({ type: 'varchar', length: 200 })
  name: string;

  @Column({ type: 'text' })
  url: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
