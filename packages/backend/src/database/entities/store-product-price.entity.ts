import { Entity, PrimaryGeneratedColumn, Column, Index, CreateDateColumn, UpdateDateColumn } from 'typeorm';

/**
 * StoreProductPrice — per-store price OVERRIDE (decision 4). The product's own
 * priceMinorUnits is the default; when an ACTIVE override exists (optionally
 * within a [startsAt, endsAt] window) it takes PRIORITY at sale time. One
 * override row per product (the catalog is already store-scoped, so product_id
 * implies the store). Every change is historised via price_history.
 */
@Entity('store_product_prices')
export class StoreProductPriceEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'store_id', type: 'uuid' })
  storeId: string;

  @Column({ name: 'product_id', type: 'uuid' })
  @Index({ unique: true })
  productId: string;

  @Column({ name: 'price_minor_units', type: 'integer' })
  priceMinorUnits: number;

  @Column({ name: 'is_active', default: true })
  isActive: boolean;

  /** Optional validity window — null bounds mean "open". */
  @Column({ name: 'starts_at', type: 'timestamp', nullable: true })
  startsAt: Date | null;

  @Column({ name: 'ends_at', type: 'timestamp', nullable: true })
  endsAt: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
