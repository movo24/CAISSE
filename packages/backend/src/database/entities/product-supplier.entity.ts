import {
  Entity, PrimaryGeneratedColumn, Column, Index, CreateDateColumn, UpdateDateColumn,
} from 'typeorm';

/** Fournisseur d'un produit (multi, avec conditions d'achat) — Lot B. */
@Entity('product_suppliers')
@Index(['productId'])
export class ProductSupplierEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'product_id', type: 'uuid' })
  productId: string;

  @Column({ name: 'store_id', type: 'uuid' })
  storeId: string;

  @Column({ name: 'supplier_id', type: 'uuid' })
  supplierId: string;

  @Column({ name: 'is_primary', type: 'boolean', default: false })
  isPrimary: boolean;

  @Column({ name: 'supplier_ref', type: 'varchar', nullable: true })
  supplierRef: string | null;

  @Column({ name: 'purchase_price_minor_units', type: 'integer', nullable: true })
  purchasePriceMinorUnits: number | null;

  @Column({ name: 'currency_code', type: 'varchar', length: 3, default: 'EUR' })
  currencyCode: string;

  @Column({ name: 'lead_time_days', type: 'integer', nullable: true })
  leadTimeDays: number | null;

  @Column({ name: 'min_order_quantity', type: 'integer', nullable: true })
  minOrderQuantity: number | null;

  @Column({ type: 'varchar', length: 12, nullable: true })
  incoterm: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
