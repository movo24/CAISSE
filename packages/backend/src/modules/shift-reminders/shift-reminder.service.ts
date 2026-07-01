import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { TimewinService } from '../timewin/timewin.service';
import { NotificationService } from '../../common/messaging/notification.service';
import { isQuietHour, isHoliday } from './quiet-hours';

/** A shift normalized from whatever shape TimeWin24's today-shifts feed returns. */
export interface NormalizedShift {
  id: string;
  employeeName: string;
  startsAt: Date;
  phone?: string;
  email?: string;
}

/**
 * ShiftReminderService — sends an automatic reminder before an employee's shift.
 *
 * Disabled by default. Enabled only when SHIFT_REMINDERS_ENABLED=true AND at
 * least one notification channel (SMS/email) is configured — otherwise the cron
 * is a no-op (graceful, like TimeWin24). The reminder is sent once per shift per
 * day (in-memory dedup, reset daily).
 */
@Injectable()
export class ShiftReminderService {
  private readonly logger = new Logger(ShiftReminderService.name);
  private readonly lookaheadMin: number;
  /** shift ids already reminded today (cleared on date change). */
  private firedToday = new Set<string>();
  private firedDay = '';

  private readonly quietStart: number;
  private readonly quietEnd: number;
  private readonly holidays: Set<string>;

  constructor(
    private readonly config: ConfigService,
    private readonly timewin: TimewinService,
    private readonly notifications: NotificationService,
  ) {
    this.lookaheadMin = parseInt(this.config.get('SHIFT_REMINDER_LOOKAHEAD_MIN', '60'), 10);
    // POS-055 (TD-055 wiring) — pure config, OFF by default: with no env set,
    // start === end → empty window → zero behavior change. Hours are SERVER-LOCAL.
    this.quietStart = parseInt(this.config.get('SHIFT_REMINDER_QUIET_START_HOUR', '0'), 10);
    this.quietEnd = parseInt(this.config.get('SHIFT_REMINDER_QUIET_END_HOUR', '0'), 10);
    this.holidays = new Set(
      (this.config.get('SHIFT_REMINDER_HOLIDAYS_ISO', '') as string)
        .split(',')
        .map((s) => s.trim())
        .filter((s) => /^\d{4}-\d{2}-\d{2}$/.test(s)),
    );
  }

  /** POS-055 — true when the sweep must stay silent (quiet window or holiday). */
  isSuppressed(now: Date): boolean {
    return isQuietHour(now.getHours(), this.quietStart, this.quietEnd) || isHoliday(now, this.holidays);
  }

  isEnabled(): boolean {
    return (
      this.config.get('SHIFT_REMINDERS_ENABLED') === 'true' &&
      (this.notifications.smsEnabled || this.notifications.emailEnabled)
    );
  }

  /** Cron entrypoint — runs every 15 min; no-op unless enabled. */
  @Cron(CronExpression.EVERY_30_MINUTES)
  async scheduledSweep(): Promise<void> {
    if (!this.isEnabled()) return;
    await this.runReminderSweep(new Date());
  }

  /**
   * Pure selection: shifts starting within (now, now + window] that haven't been
   * reminded yet. Extracted for testability — no I/O.
   */
  selectDueShifts(
    shifts: NormalizedShift[],
    now: Date,
    windowMin: number,
    alreadyFired: Set<string>,
  ): NormalizedShift[] {
    const horizon = now.getTime() + windowMin * 60_000;
    return shifts.filter((s) => {
      if (!s.id || alreadyFired.has(s.id)) return false;
      const t = s.startsAt.getTime();
      return t > now.getTime() && t <= horizon;
    });
  }

  /** Defensively map TimeWin24's loosely-typed shift records into NormalizedShift. */
  normalizeShifts(raw: unknown): NormalizedShift[] {
    const list: any[] = Array.isArray(raw)
      ? raw
      : Array.isArray((raw as any)?.shifts)
        ? (raw as any).shifts
        : [];
    const out: NormalizedShift[] = [];
    for (const r of list) {
      const id = r?.id ?? r?.shiftId ?? r?.shift_id;
      const startRaw = r?.startsAt ?? r?.startAt ?? r?.start ?? r?.startTime ?? r?.start_at;
      if (!id || !startRaw) continue;
      const startsAt = new Date(startRaw);
      if (isNaN(startsAt.getTime())) continue;
      out.push({
        id: String(id),
        employeeName: r?.employeeName ?? r?.employee_name ?? r?.fullName ?? 'Employé',
        startsAt,
        phone: r?.phone ?? r?.employeePhone ?? r?.employee_phone ?? undefined,
        email: r?.email ?? r?.employeeEmail ?? r?.employee_email ?? undefined,
      });
    }
    return out;
  }

  /** Orchestration: per store, fetch shifts, pick due ones, notify, dedupe. */
  async runReminderSweep(now: Date): Promise<{ stores: number; reminded: number }> {
    this.rotateDayIfNeeded(now);

    if (this.isSuppressed(now)) {
      this.logger.log('[SHIFT_REMINDER] suppressed (quiet hours / holiday) — no reminders sent');
      return { stores: 0, reminded: 0 };
    }

    let stores: any[] = [];
    try {
      stores = await this.timewin.fetchStores();
    } catch (err: any) {
      this.logger.warn(`[SHIFT_REMINDER] cannot fetch stores (TW24 down?): ${err?.message}`);
      return { stores: 0, reminded: 0 };
    }

    let reminded = 0;
    for (const store of stores) {
      const storeId = store?.id ?? store?.storeId ?? store?.store_id;
      if (!storeId) continue;
      try {
        const raw = await this.timewin.getTodayShifts(String(storeId));
        const due = this.selectDueShifts(
          this.normalizeShifts(raw),
          now,
          this.lookaheadMin,
          this.firedToday,
        );
        for (const shift of due) {
          await this.sendReminder(shift);
          this.firedToday.add(shift.id);
          reminded++;
        }
      } catch (err: any) {
        this.logger.warn(`[SHIFT_REMINDER] store ${storeId} skipped: ${err?.message}`);
      }
    }
    if (reminded > 0) this.logger.log(`[SHIFT_REMINDER] sent ${reminded} reminder(s)`);
    return { stores: stores.length, reminded };
  }

  private async sendReminder(shift: NormalizedShift): Promise<void> {
    const time = shift.startsAt.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    const body = `Rappel : votre service commence à ${time}. Bonne journée !`;
    await this.notifications.notify({
      prefer: 'sms',
      sms: shift.phone ? { to: shift.phone, body } : undefined,
      email: shift.email
        ? { to: shift.email, subject: 'Rappel de service', html: `<p>${body}</p>` }
        : undefined,
    });
  }

  private rotateDayIfNeeded(now: Date): void {
    const day = now.toISOString().slice(0, 10);
    if (day !== this.firedDay) {
      this.firedDay = day;
      this.firedToday = new Set();
    }
  }
}
