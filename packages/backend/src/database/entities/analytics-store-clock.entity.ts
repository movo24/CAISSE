import { Entity, PrimaryGeneratedColumn, Column, Index } from 'typeorm';

/**
 * STORE CLOCK — the store wall-clock policy as a SINGLE datum (ratified): one
 * source consumed by the ai-brief BEATS, the store_closed_late rule, and (future)
 * the business-day definition. Never three parallel TZ configs that drift.
 *
 * STAND-IN (documented): `timezone` is seeded 'Etc/UTC' — hours below are read as
 * UTC wall-clock until the real store-TZ policy lands (D-ALERTS-1). With the UTC
 * stand-in, the seeded defaults (beats [10, 15] + close 20) sit ≈ 12h/17h/22h
 * Paris in summer and drift 1h across DST — acceptable for brief beats (benign),
 * NOT for delivering a "late" alert (which is why store_closed_late stays
 * delivery-frozen by D-ALERTS-1 even though it reads this datum).
 * When the TZ policy lands: set `timezone` per store, interpret the hours in it —
 * beats, the late rule and the business day all upgrade from this ONE row.
 */
@Entity({ schema: 'analytics', name: 'store_clock' })
@Index(['storeId'], { unique: true })
export class AnalyticsStoreClockEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** NULL = the network default; non-NULL = a per-store override. */
  @Column({ name: 'store_id', type: 'uuid', nullable: true })
  storeId: string | null;

  /** IANA timezone the wall-clock hours are expressed in. 'Etc/UTC' = stand-in. */
  @Column({ name: 'timezone', type: 'varchar', default: 'Etc/UTC' })
  timezone: string;

  /** Intraday brief beats (wall-clock hours in `timezone`); the close beat is closeHour. */
  @Column({ name: 'brief_beat_hours', type: 'jsonb' })
  briefBeatHours: number[];

  /** Store closing hour (wall-clock in `timezone`) — the 'fermeture' beat AND the
   *  store_closed_late threshold. ONE value, two consumers, zero drift. */
  @Column({ name: 'close_hour', type: 'integer' })
  closeHour: number;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;
}
