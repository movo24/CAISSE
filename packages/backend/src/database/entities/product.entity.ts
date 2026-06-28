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

  /**
   * POS-066 — normalized name (accents/case/whitespace folded) for per-store
   * duplicate detection. Set on create/update via normalizeName(). Nullable for
   * legacy rows (backfilled with lower(trim(name)) — accents not folded for legacy).
   * Explicit type required by the TypeORM nullable-union rule (CLAUDE.md).
   */
  @Column({ name: 'normalized_name', type: 'varchar', nullable: true })
  normalizedName: string | null;

  @Column({ nullable: true })
  description: string;

  @Column({ name: 'category_id', nullable: true })
  categoryId: string;

  @Column({ name: 'unit_type', default: 'unit' })
  unitType: string;

  @Column({ name: 'price_minor_units', type: 'integer' })
  priceMinorUnits: number;

  /**
   * POS-061 — store-specific price override. When set, it takes PRIORITY over the
   * global `price_minor_units`. Nullable → no override = global price used (no change).
   * Explicit type required by the TypeORM nullable-union rule (CLAUDE.md).
   */
  @Column({ name: 'price_override_minor_units', type: 'integer', nullable: true })
  priceOverrideMinorUnits: number | null;

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

  /**
   * POS-083 — par/max baseline used to derive the relative low-stock alert (20% of this).
   * Nullable: when unset, the absolute `stock_alert_threshold` is used (no behavior change).
   * Explicit `type` required by the TypeORM nullable-union rule (CLAUDE.md).
   */
  @Column({ name: 'stock_baseline_quantity', type: 'integer', nullable: true })
  stockBaselineQuantity: number | null;

  @Column({ name: 'is_active', default: true })
  isActive: boolean;

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
