import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { AnalyticsStoreWeeklyHoursEntity } from '../../database/entities/analytics-store-weekly-hours.entity';
import { AnalyticsStoreHolidayClosureEntity } from '../../database/entities/analytics-store-holiday-closure.entity';
import { AuditService } from '../audit/audit.service';
import { FRENCH_HOLIDAY_KEYS, FrenchHolidayKey } from './french-holidays.util';

/**
 * BackOffice WRITE surface for the schedule datum (admin router — NEVER the
 * GET-only cockpit router, INV-1). The server-side validation is the GUARANTEE;
 * the BackOffice client mirrors it for UX only.
 *
 * Writing here mutates THE source the resolver serves to store_closed_late and
 * the close beat — one datum, no duplication. (The legacy TimeWin24 schedule
 * push stays as a best-effort DOWNSTREAM sync at the controller, fail-soft —
 * TW24 is informed, never authoritative.)
 */
export interface ScheduleDayDto {
  dayOfWeek: number; // 0 = dimanche … 6 = samedi (JS getDay — same as the grid)
  closed: boolean;
  openTime?: string | null; // 'HH:MM' local wall-clock
  closeTime?: string | null;
}

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Server-side validation (the guarantee — mirrored client-side for UX). */
export function validateWeeklySchedule(days: ScheduleDayDto[]): void {
  if (!Array.isArray(days) || days.length !== 7) {
    throw new BadRequestException('Le planning doit contenir exactement 7 jours.');
  }
  const seen = new Set<number>();
  for (const d of days) {
    if (!Number.isInteger(d.dayOfWeek) || d.dayOfWeek < 0 || d.dayOfWeek > 6) {
      throw new BadRequestException(`Jour invalide: ${d.dayOfWeek} (attendu 0–6).`);
    }
    if (seen.has(d.dayOfWeek)) {
      throw new BadRequestException(`Jour en double: ${d.dayOfWeek}.`);
    }
    seen.add(d.dayOfWeek);
    if (d.closed) continue; // a closed day carries no hours
    if (!d.openTime || !HHMM.test(d.openTime) || !d.closeTime || !HHMM.test(d.closeTime)) {
      throw new BadRequestException(`Jour ${d.dayOfWeek}: heures attendues au format HH:MM.`);
    }
    if (d.openTime >= d.closeTime) {
      throw new BadRequestException(`Jour ${d.dayOfWeek}: l'ouverture (${d.openTime}) doit précéder la fermeture (${d.closeTime}).`);
    }
  }
}

@Injectable()
export class StoreScheduleAdminService {
  constructor(
    @InjectRepository(AnalyticsStoreWeeklyHoursEntity)
    private readonly weeklyHours: Repository<AnalyticsStoreWeeklyHoursEntity>,
    @InjectRepository(AnalyticsStoreHolidayClosureEntity)
    private readonly holidayClosures: Repository<AnalyticsStoreHolidayClosureEntity>,
    private readonly audit: AuditService,
  ) {}

  /** Effective grid for the UI: the store's rows, else the network default. */
  async getWeekly(storeId: string): Promise<{ source: 'store' | 'default' | 'none'; days: ScheduleDayDto[] }> {
    const own = await this.weeklyHours.find({ where: { storeId, isActive: true }, order: { weekday: 'ASC' } });
    const rows = own.length
      ? own
      : await this.weeklyHours.find({ where: { storeId: IsNull(), isActive: true }, order: { weekday: 'ASC' } });
    return {
      source: own.length ? 'store' : rows.length ? 'default' : 'none',
      days: rows.map((r) => ({
        dayOfWeek: r.weekday,
        closed: r.isClosed,
        openTime: r.openLocal ? String(r.openLocal).slice(0, 5) : null,
        closeTime: r.closeLocal ? String(r.closeLocal).slice(0, 5) : null,
      })),
    };
  }

  /**
   * Set-replace the store's 7 rows (validated — this IS the resolver's source).
   * The mutation and its chained audit entry are written ATOMICALLY (runWithAudit):
   * the hours can never change without an attributable audit record, and vice versa.
   */
  async putWeekly(storeId: string, days: ScheduleDayDto[], actorEmployeeId: string): Promise<void> {
    validateWeeklySchedule(days);
    await this.audit.runWithAudit(
      {
        storeId,
        employeeId: actorEmployeeId,
        action: 'store_hours_updated',
        entityType: 'store_schedule',
        entityId: storeId,
        details: {
          days: days.map((d) => ({
            d: d.dayOfWeek,
            closed: d.closed,
            open: d.closed ? null : d.openTime,
            close: d.closed ? null : d.closeTime,
          })),
        },
      },
      async (m) => {
        const repo = m.getRepository(AnalyticsStoreWeeklyHoursEntity);
        await repo.delete({ storeId });
        for (const d of days) {
          await repo.insert({
            storeId,
            weekday: d.dayOfWeek,
            openLocal: d.closed ? null : d.openTime!,
            closeLocal: d.closed ? null : d.closeTime!,
            isClosed: d.closed,
            isActive: true,
          });
        }
      },
    );
  }

  /** The full checklist (all 11 keys), checked = this store closes that day. */
  async getHolidays(storeId: string): Promise<Array<{ key: FrenchHolidayKey; closed: boolean }>> {
    const rows = await this.holidayClosures.find({ where: { storeId } });
    const checked = new Set(rows.map((r) => r.holidayKey));
    return FRENCH_HOLIDAY_KEYS.map((key) => ({ key, closed: checked.has(key) }));
  }

  /** Set-replace the store's closure selection (unknown keys rejected). Atomic with audit. */
  async putHolidays(storeId: string, closedKeys: string[], actorEmployeeId: string): Promise<void> {
    if (!Array.isArray(closedKeys)) throw new BadRequestException('closedHolidayKeys doit être une liste.');
    const valid = new Set<string>(FRENCH_HOLIDAY_KEYS);
    for (const key of closedKeys) {
      if (!valid.has(key)) throw new BadRequestException(`Jour férié inconnu: ${key}.`);
    }
    const unique = [...new Set(closedKeys)];
    await this.audit.runWithAudit(
      {
        storeId,
        employeeId: actorEmployeeId,
        action: 'store_holidays_updated',
        entityType: 'store_schedule',
        entityId: storeId,
        details: { closedHolidayKeys: unique },
      },
      async (m) => {
        const repo = m.getRepository(AnalyticsStoreHolidayClosureEntity);
        await repo.delete({ storeId });
        for (const holidayKey of unique) {
          await repo.insert({ storeId, holidayKey });
        }
      },
    );
  }
}
