import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { AnalyticsStoreWeeklyHoursEntity } from '../../database/entities/analytics-store-weekly-hours.entity';
import { AnalyticsStoreHolidayClosureEntity } from '../../database/entities/analytics-store-holiday-closure.entity';
import { holidayKeyOf } from './french-holidays.util';

/**
 * SCHEDULE RESOLVER — the SINGLE source for "is this store open on that local
 * day, and until when". store_closed_late and the close beat call THIS; neither
 * re-derives hours from anywhere else (one source per datum).
 *
 * resolve(storeId, localDay) over OWNER data, composed (ratified: férié > hebdo):
 *   - localDay is a French holiday THIS store closes on (store_holiday_closures
 *     row, owner checklist) → CLOSED
 *   - else weekday row is_closed → CLOSED
 *   - else {openLocal, closeLocal}
 *   - no datum at all → null (honest absence: callers SKIP, never invent hours)
 *
 * Times are LOCAL wall-clock 'HH:MM' strings in the store's clock timezone (A1).
 * NON-fiscal: never consulted for the Z business day.
 */
export type ResolvedSchedule = { openLocal: string; closeLocal: string } | 'closed' | null;

@Injectable()
export class StoreScheduleService {
  constructor(
    @InjectRepository(AnalyticsStoreWeeklyHoursEntity)
    private readonly weeklyHours: Repository<AnalyticsStoreWeeklyHoursEntity>,
    @InjectRepository(AnalyticsStoreHolidayClosureEntity)
    private readonly holidayClosures: Repository<AnalyticsStoreHolidayClosureEntity>,
  ) {}

  /** storeId null → network default rows only (e.g. a multi-store brief scope). */
  async resolve(storeId: string | null, localDay: string): Promise<ResolvedSchedule> {
    // Holiday closure beats the weekly row (owner's per-store checklist).
    if (storeId) {
      const holidayKey = holidayKeyOf(localDay);
      if (holidayKey && (await this.holidayClosures.findOne({ where: { storeId, holidayKey } }))) {
        return 'closed';
      }
    }
    const weekday = weekdayOf(localDay);
    const row =
      (storeId ? await this.weeklyHours.findOne({ where: { storeId, weekday, isActive: true } }) : null) ??
      (await this.weeklyHours.findOne({ where: { storeId: IsNull(), weekday, isActive: true } }));
    if (!row) return null; // no datum — callers skip (never invent an hour)
    if (row.isClosed || row.openLocal == null || row.closeLocal == null) return 'closed';
    return { openLocal: hhmm(row.openLocal), closeLocal: hhmm(row.closeLocal) };
  }
}

/** Weekday of a 'YYYY-MM-DD' LOCAL day string — zone-free (0 = dimanche … 6 = samedi). */
export const weekdayOf = (localDay: string): number =>
  new Date(`${localDay}T00:00:00Z`).getUTCDay();

/** pg `time` reads back as 'HH:MM:SS' — normalize to 'HH:MM'. */
const hhmm = (t: string): string => String(t).slice(0, 5);

/** 'HH:MM' → minutes since local midnight (for wall-clock threshold compares). */
export const minutesOf = (t: string): number => {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
};
