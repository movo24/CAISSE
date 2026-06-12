import { Entity, PrimaryGeneratedColumn, Column, Index } from 'typeorm';

/**
 * ANALYTICS PROJECTION — staff-presence snapshot per store (read model).
 * INV-2: separate read-model table, cockpit-read-only, jobs-only writer.
 * INV-4: presence is owned by TimeWin24 — there is NO local attendance table (that
 * would be a 2nd source of truth). The refresh job SNAPSHOTS presence via the
 * TimeWin24 proxy into this projection; `computed_at` carries the freshness.
 * INV-5: `store_id` is the query-layer scoping key.
 */
@Entity({ schema: 'analytics', name: 'store_presence' })
@Index(['storeId'], { unique: true })
export class AnalyticsStorePresenceEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'store_id', type: 'uuid' })
  storeId: string;

  @Column({ name: 'present_count', type: 'integer', default: 0 })
  presentCount: number;

  @Column({ name: 'expected_count', type: 'integer', default: 0 })
  expectedCount: number;

  @Column({ name: 'computed_at', type: 'timestamptz' })
  computedAt: Date;
}
