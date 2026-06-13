import { Entity, PrimaryGeneratedColumn, Column, Index } from 'typeorm';

/**
 * A5 — per-(store, business_day, product) sales projection (étage 0 read model).
 * Aggregated from the COMPLETED sales' line items over the LOCAL business-day
 * window (A1) by the POS refresh job — the only writer (INV-2/INV-4). Revenue
 * only: margin/cost are OUT of V1 (ratified). Exactly the ratified tuple +
 * `computed_at` (the étage-0 freshness/monotonicity datum every projection carries).
 */
@Entity({ schema: 'analytics', name: 'store_product_daily' })
@Index(['storeId', 'businessDay', 'productId'], { unique: true })
@Index(['storeId'])
export class AnalyticsStoreProductDailyEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'store_id', type: 'uuid' })
  storeId: string;

  @Column({ name: 'business_day', type: 'date' })
  businessDay: string;

  @Column({ name: 'product_id', type: 'uuid' })
  productId: string;

  /** Units sold across the day's completed sales (sum of line-item quantities). */
  @Column({ type: 'integer', default: 0 })
  qty: number;

  /** Revenue of those lines (centimes) — sum of line totals (post-discount, like ca_brut). */
  @Column({ name: 'revenue_minor', type: 'integer', default: 0 })
  revenueMinor: number;

  @Column({ name: 'computed_at', type: 'timestamptz' })
  computedAt: Date;
}
