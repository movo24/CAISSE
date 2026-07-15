import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { StoreEntity } from './store.entity';

@Entity('products')
@Index(['ean', 'storeId'], { unique: true })
@Index(['storeId', 'isActive'])
export class ProductEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  ean: string;

  @Column({ name: 'barcode_source', type: 'varchar', default: 'imported' })
  barcodeSource: 'imported' | 'manual' | 'generated';

  @Column()
  name: string;

  @Column({ nullable: true })
  description: string;

  @Column({ name: 'category_id', nullable: true })
  categoryId: string;

  @Column({ name: 'brand_id', type: 'uuid', nullable: true })
  brandId: string | null;

  @Column({ name: 'supplier_id', type: 'uuid', nullable: true })
  supplierId: string | null;

  /** Variants (decision 5): a variant is a product row whose parent is set. */
  @Column({ name: 'parent_product_id', type: 'uuid', nullable: true })
  parentProductId: string | null;

  @Column({ type: 'varchar', nullable: true })
  sku: string | null;

  @Column({ name: 'variant_name', type: 'varchar', nullable: true })
  variantName: string | null;

  @Column({ name: 'unit_type', default: 'unit' })
  unitType: string;

  @Column({ name: 'price_minor_units', type: 'integer' })
  priceMinorUnits: number;

  @Column({ name: 'old_price_minor_units', type: 'integer', nullable: true })
  oldPriceMinorUnits: number | null;

  @Column({ name: 'currency_code', default: 'EUR' })
  currencyCode: string;

  @Column({ name: 'cost_minor_units', type: 'integer', nullable: true })
  costMinorUnits: number;

  @Column({ name: 'tax_rate', type: 'decimal', default: 20.0 })
  taxRate: number;

  @Column({ name: 'image_url', nullable: true, type: 'text' })
  imageUrl: string | null;

  @Column({ name: 'stock_quantity', type: 'integer', default: 0 })
  stockQuantity: number;

  @Column({ name: 'stock_alert_threshold', type: 'integer', default: 10 })
  stockAlertThreshold: number;

  @Column({ name: 'stock_critical_threshold', type: 'integer', default: 5 })
  stockCriticalThreshold: number;

  @Column({ name: 'is_active', default: true })
  isActive: boolean;

  /**
   * Cycle de vie de la fiche produit. Un produit ne se vend que lorsqu'il est
   * `active` (isActive reste la colonne filtrée par la vente ; elle est tenue
   * en cohérence : isActive === (status === 'active')).
   */
  @Column({ type: 'varchar', default: 'active' })
  status: 'draft' | 'pending_validation' | 'active' | 'rejected' | 'archived';

  // ── Lot 2 — champs additifs de la fiche pro (migration 1760, tous nullables) ──
  @Column({ name: 'short_name', type: 'varchar', nullable: true })
  shortName: string | null;

  @Column({ name: 'internal_ref', type: 'varchar', nullable: true })
  internalRef: string | null;

  @Column({ name: 'supplier_ref', type: 'varchar', nullable: true })
  supplierRef: string | null;

  @Column({ name: 'product_type', type: 'varchar', default: 'simple' })
  productType: 'simple' | 'variant' | 'pack' | 'service' | 'deposit' | 'gift_card';

  @Column({ name: 'country_of_origin', type: 'varchar', nullable: true })
  countryOfOrigin: string | null;

  @Column({ name: 'lead_time_days', type: 'integer', nullable: true })
  leadTimeDays: number | null;

  @Column({ name: 'min_order_quantity', type: 'integer', nullable: true })
  minOrderQuantity: number | null;

  @Column({ name: 'weight_grams', type: 'integer', nullable: true })
  weightGrams: number | null;

  @Column({ name: 'width_mm', type: 'integer', nullable: true })
  widthMm: number | null;

  @Column({ name: 'height_mm', type: 'integer', nullable: true })
  heightMm: number | null;

  @Column({ name: 'depth_mm', type: 'integer', nullable: true })
  depthMm: number | null;

  @Column({ name: 'volume_ml', type: 'integer', nullable: true })
  volumeMl: number | null;

  @Column({ name: 'units_per_carton', type: 'integer', nullable: true })
  unitsPerCarton: number | null;

  @Column({ name: 'store_id' })
  storeId: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  @ManyToOne(() => StoreEntity, (s) => s.products)
  @JoinColumn({ name: 'store_id' })
  store: StoreEntity;
}
