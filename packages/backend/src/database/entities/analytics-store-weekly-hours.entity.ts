import { Entity, PrimaryGeneratedColumn, Column, Index } from 'typeorm';

/**
 * STORE WEEKLY HOURS — per-weekday opening hours as OWNER data (BackOffice grid).
 * Wall-clock LOCAL times in the store's clock timezone (A1). Read ONLY through
 * the schedule resolver (single source — store_closed_late and the close beat
 * never re-derive). NON-fiscal: never feeds the Z business day.
 *
 * weekday 0–6 = JS getDay() convention (0 = dimanche … 6 = samedi).
 * store_id NULL = network default (same pattern as store_clock); a per-store
 * override is a full 7-row set. open/close are 'HH:MM[:SS]' strings (pg `time`),
 * null when is_closed.
 */
@Entity({ schema: 'analytics', name: 'store_weekly_hours' })
@Index(['storeId', 'weekday'], { unique: true })
export class AnalyticsStoreWeeklyHoursEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'store_id', type: 'uuid', nullable: true })
  storeId: string | null;

  /** 0 = dimanche … 6 = samedi (JS getDay). */
  @Column({ type: 'integer' })
  weekday: number;

  @Column({ name: 'open_local', type: 'time', nullable: true })
  openLocal: string | null;

  @Column({ name: 'close_local', type: 'time', nullable: true })
  closeLocal: string | null;

  @Column({ name: 'is_closed', type: 'boolean', default: false })
  isClosed: boolean;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  @Column({ name: 'updated_at', type: 'timestamptz', default: () => 'now()' })
  updatedAt: Date;
}
