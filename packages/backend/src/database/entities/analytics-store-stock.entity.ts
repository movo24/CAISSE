import { Entity, PrimaryGeneratedColumn, Column, Index } from 'typeorm';

/**
 * ANALYTICS PROJECTION — stock/rupture snapshot per store (read model).
 * INV-2: separate read-model table, cockpit-read-only, jobs-only writer.
 * INV-4: stock is owned by Inventory — the canonical source is `stock_balances`
 * (per-location quantity + alert/critical thresholds), NOT the legacy
 * `products.stock_quantity`. The refresh job derives rupture/low-stock counts from
 * stock_balances; the projection consolidates, it does not recompute stock.
 * INV-5: `store_id` is the query-layer scoping key.
 */
@Entity('analytics_store_stock')
@Index(['storeId'], { unique: true })
export class AnalyticsStoreStockEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'store_id', type: 'uuid' })
  storeId: string;

  /** Products at/under critical threshold (rupture). */
  @Column({ name: 'rupture_count', type: 'integer', default: 0 })
  ruptureCount: number;

  /** Products at/under alert threshold (low stock, not yet rupture). */
  @Column({ name: 'low_stock_count', type: 'integer', default: 0 })
  lowStockCount: number;

  @Column({ name: 'computed_at', type: 'timestamptz' })
  computedAt: Date;
}
