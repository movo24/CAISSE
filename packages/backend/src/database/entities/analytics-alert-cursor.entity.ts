import { Entity, PrimaryColumn, Column } from 'typeorm';

/**
 * ALERT CURSOR — the computed_at gate. One row per store: the engine evaluates a
 * store ONLY when the projection's freshness has ADVANCED past this cursor — the
 * engine's idempotence is anchored on the étage-0 computed_at monotonicity (hard
 * guard), not on its own clock.
 */
@Entity({ schema: 'analytics', name: 'alert_cursor' })
export class AnalyticsAlertCursorEntity {
  @PrimaryColumn({ name: 'store_id', type: 'uuid' })
  storeId: string;

  @Column({ name: 'last_computed_at', type: 'timestamptz' })
  lastComputedAt: Date;
}
