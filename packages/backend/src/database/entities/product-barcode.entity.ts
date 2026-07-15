import { Entity, PrimaryGeneratedColumn, Column, Index, CreateDateColumn } from 'typeorm';

/** Codes-barres secondaires d'un produit (EAN/UPC/GTIN/autre) — Lot A. */
@Entity('product_barcodes')
@Index(['productId'])
export class ProductBarcodeEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'product_id', type: 'uuid' })
  productId: string;

  @Column({ name: 'store_id', type: 'uuid' })
  storeId: string;

  @Column({ type: 'varchar', length: 64 })
  barcode: string;

  @Column({ type: 'varchar', length: 12, default: 'ean' })
  type: 'ean' | 'upc' | 'gtin' | 'other';

  @Column({ name: 'is_primary', type: 'boolean', default: false })
  isPrimary: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
