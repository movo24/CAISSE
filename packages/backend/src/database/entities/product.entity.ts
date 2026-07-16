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

  // ── Lot E — saisonnalité (fenêtre par mois, récurrente) ──
  @Column({ name: 'is_seasonal', type: 'boolean', default: false })
  isSeasonal: boolean;

  @Column({ name: 'season_start_month', type: 'integer', nullable: true })
  seasonStartMonth: number | null;

  @Column({ name: 'season_end_month', type: 'integer', nullable: true })
  seasonEndMonth: number | null;

  // ── Lot I — prix encadrés, conditionnement, réglementaire alimentaire ──
  @Column({ name: 'min_price_minor_units', type: 'integer', nullable: true })
  minPriceMinorUnits: number | null;

  @Column({ name: 'recommended_price_minor_units', type: 'integer', nullable: true })
  recommendedPriceMinorUnits: number | null;

  @Column({ name: 'units_per_pack', type: 'integer', nullable: true })
  unitsPerPack: number | null;

  @Column({ name: 'cartons_per_pallet', type: 'integer', nullable: true })
  cartonsPerPallet: number | null;

  @Column({ type: 'text', nullable: true })
  allergens: string | null;

  @Column({ type: 'text', nullable: true })
  ingredients: string | null;

  @Column({ name: 'best_before_date', type: 'date', nullable: true })
  bestBeforeDate: string | null;

  @Column({ name: 'use_by_date', type: 'date', nullable: true })
  useByDate: string | null;

  @Column({ name: 'lot_number', type: 'varchar', length: 60, nullable: true })
  lotNumber: string | null;

  // ── P-A / M-A — complétion « fiche produit ERP » (migration 1768, tous additifs) ──
  /** Désignation commerciale longue (≤300). Distincte de `shortName` (libellé court catalogue). */
  @Column({ name: 'long_designation', type: 'varchar', length: 300, nullable: true })
  longDesignation: string | null;

  /** Description interne (non publique). `description` reste la description publique. */
  @Column({ name: 'internal_description', type: 'text', nullable: true })
  internalDescription: string | null;

  /** Libellé exact imprimé sur le ticket (contrainte largeur imprimante, ≤80). */
  @Column({ name: 'receipt_description', type: 'varchar', length: 80, nullable: true })
  receiptDescription: string | null;

  @Column({ name: 'manufacturer', type: 'varchar', length: 120, nullable: true })
  manufacturer: string | null;

  /**
   * Cycle de vie COMMERCIAL — orthogonal au `status` workflow ci-dessus.
   * `status` = validation (draft/pending_validation/active/rejected/archived) ;
   * `lifecycleStatus` = commercialisation (un produit validé peut être `discontinued`).
   */
  @Column({ name: 'lifecycle_status', type: 'varchar', length: 20, default: 'active' })
  lifecycleStatus: 'active' | 'inactive' | 'discontinued' | 'seasonal';

  /** Poids net. `weightGrams` existant = poids brut (emballage compris). */
  @Column({ name: 'weight_net_g', type: 'integer', nullable: true })
  weightNetG: number | null;

  // Planification de stock ERP (distincte des seuils d'alerte POS existants).
  @Column({ name: 'stock_reserved', type: 'integer', default: 0 })
  stockReserved: number;

  @Column({ name: 'stock_min', type: 'integer', nullable: true })
  stockMin: number | null;

  @Column({ name: 'stock_max', type: 'integer', nullable: true })
  stockMax: number | null;

  @Column({ name: 'stock_safety', type: 'integer', nullable: true })
  stockSafety: number | null;

  // Emplacement magasin — marquage texte court (complémentaire à stock_locations).
  @Column({ name: 'aisle', type: 'varchar', length: 40, nullable: true })
  aisle: string | null;

  @Column({ name: 'shelf', type: 'varchar', length: 40, nullable: true })
  shelf: string | null;

  @Column({ name: 'level', type: 'varchar', length: 40, nullable: true })
  level: string | null;

  @Column({ name: 'tags', type: 'jsonb', default: () => "'[]'" })
  tags: string[];

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
