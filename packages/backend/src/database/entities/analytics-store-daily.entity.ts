import { Entity, PrimaryGeneratedColumn, Column, Index } from 'typeorm';

/**
 * ANALYTICS PROJECTION — read model (étage 0, Wesley Command Center).
 *
 * INV-2 (structural): this is a table SEPARATE from the source/transactional
 * tables. The cockpit reads ONLY `analytics_*` tables; the refresh jobs are the
 * ONLY writers. The cockpit NEVER reads sales / fiscal_journal / credit_notes /
 * z_reports directly. (V1 isolates by table prefix in the public schema; the
 * RLS-ready evolution is a dedicated Postgres `analytics` schema + policies — a
 * later migration, since these tables are already isolated and source-free.)
 *
 * INV-4 (consolidate, don't recompute): one (store, business_day) POS summary,
 * CONSOLIDATED from the POS source of truth — revenue from the POS (the sealed
 * z_report for closed days, the sales aggregate for the open day), voids from
 * fiscal_journal, returns from credit_notes. The projection never re-derives the
 * fiscal truth, it copies the source's figures.
 *
 * INV-5 (tenant scope): `store_id` is the scoping key — every cockpit query filters
 * `WHERE store_id IN (:accessibleStores)` in the QUERY layer (never in the UI).
 */
@Entity('analytics_store_daily')
@Index(['storeId', 'businessDay'], { unique: true })
@Index(['storeId'])
export class AnalyticsStoreDailyEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'store_id', type: 'uuid' })
  storeId: string;

  @Column({ name: 'business_day', type: 'date' })
  businessDay: string;

  /** Gross revenue (centimes) — copied from the POS source, not re-derived. */
  @Column({ name: 'ca_brut_minor', type: 'integer', default: 0 })
  caBrutMinor: number;

  @Column({ name: 'tx_count', type: 'integer', default: 0 })
  txCount: number;

  /** Voids ← fiscal_journal (event-time). */
  @Column({ name: 'void_count', type: 'integer', default: 0 })
  voidCount: number;

  @Column({ name: 'void_amount_minor', type: 'integer', default: 0 })
  voidAmountMinor: number;

  /** Returns ← credit_notes. */
  @Column({ name: 'returns_amount_minor', type: 'integer', default: 0 })
  returnsAmountMinor: number;

  /** net = ca_brut − returns (voids already excluded from completed sales). */
  @Column({ name: 'net_minor', type: 'integer', default: 0 })
  netMinor: number;

  /** Tender breakdown, e.g. { cash, card, voucher, gift_card, store_credit }. */
  @Column({ name: 'by_tender', type: 'jsonb', nullable: true })
  byTender: Record<string, number> | null;

  /** Freshness of this projected row (INV: every projection carries computed_at). */
  @Column({ name: 'computed_at', type: 'timestamptz' })
  computedAt: Date;
}
