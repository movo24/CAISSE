import { Entity, PrimaryGeneratedColumn, Column, Index } from 'typeorm';

/**
 * STORE CLOCK — the store wall-clock policy as a SINGLE datum (ratified): one
 * source consumed by the ai-brief BEATS, the store_closed_late rule, and (future)
 * the business-day definition. Never three parallel TZ configs that drift.
 *
 * A1 (ratified): `timezone` is a real IANA zone (network default seeded
 * 'Europe/Paris' by migration 1730; B43 = Europe/Paris). Every hour below is a
 * LOCAL wall-clock value in that zone — beats and the business day
 * read this ONE row (per-store override = one UPDATE of owner data). The original
 * 'Etc/UTC' stand-in (and the D-ALERTS-1 freeze it forced) is gone.
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

  /** Intraday brief beats (wall-clock hours in `timezone`); the close beat comes
   * from the schedule resolver (store_weekly_hours) since the schedule chantier. */
  @Column({ name: 'brief_beat_hours', type: 'jsonb' })
  briefBeatHours: number[];

  /** Store closing hour (wall-clock in `timezone`) — the 'fermeture' beat AND the
   *  store_closed_late threshold. ONE value, two consumers, zero drift. */

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;
}
