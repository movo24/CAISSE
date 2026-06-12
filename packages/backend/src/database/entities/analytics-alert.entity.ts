import { Entity, PrimaryGeneratedColumn, Column, Index, CreateDateColumn } from 'typeorm';

/**
 * ANALYTICS ALERTS — étage 2 (alerts-engine). A derived FACT ("threshold crossed"),
 * not its delivery (push/quiet-hours = étage 4).
 *
 * INV-6 (structural): at most ONE alert per (store, rule, business_day,
 * threshold_band) — enforced by the UNIQUE index, absorbed at write time
 * (insert + 23505 → dedup), never check-then-insert.
 * INV-2: produced exclusively from `analytics.*` reads; lives in the analytics
 * schema (engine INSERTs with the backend role; the mobile API role stays
 * SELECT-only — the GRANT model of DEBT D-ANALYTICS-1 holds).
 */
@Entity({ schema: 'analytics', name: 'alerts' })
@Index(['storeId', 'rule', 'businessDay', 'thresholdBand'], { unique: true })
@Index(['storeId', 'businessDay'])
export class AnalyticsAlertEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'store_id', type: 'uuid' })
  storeId: string;

  @Column({ name: 'rule', type: 'varchar' })
  rule: string;

  /** The business day the FACT belongs to (may be a closed prior day, e.g. sales_drop). */
  @Column({ name: 'business_day', type: 'date' })
  businessDay: string;

  /** Severity/band component of the dedup key (e.g. 'warning', 'critical', 'rupture'). */
  @Column({ name: 'threshold_band', type: 'varchar' })
  thresholdBand: string;

  /** The fact's evidence: observed value, threshold, counts — traceable to analytics.*. */
  @Column({ name: 'payload', type: 'jsonb', nullable: true })
  payload: Record<string, unknown> | null;

  /** Freshness of the projection data that produced the fact (étage-0 computed_at). */
  @Column({ name: 'computed_at', type: 'timestamptz' })
  computedAt: Date;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
