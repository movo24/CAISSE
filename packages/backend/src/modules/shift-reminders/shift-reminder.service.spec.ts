import { ConfigService } from '@nestjs/config';
import { ShiftReminderService, NormalizedShift } from './shift-reminder.service';
import { TimewinService } from '../timewin/timewin.service';
import { NotificationService } from '../../common/messaging/notification.service';

function cfg(map: Record<string, string>): ConfigService {
  return { get: (k: string, d?: string) => (k in map ? map[k] : d) } as unknown as ConfigService;
}

const NOW = new Date('2026-06-07T08:00:00Z');
const shift = (id: string, minutesFromNow: number, extra: Partial<NormalizedShift> = {}): NormalizedShift => ({
  id,
  employeeName: 'X',
  startsAt: new Date(NOW.getTime() + minutesFromNow * 60_000),
  ...extra,
});

describe('ShiftReminderService', () => {
  const tw = {} as TimewinService;
  const notif = { smsEnabled: false, emailEnabled: false, notify: jest.fn() } as unknown as NotificationService;

  describe('selectDueShifts (pure)', () => {
    const svc = new ShiftReminderService(cfg({}), tw, notif);

    it('selects shifts starting within the window, excludes past and far-future', () => {
      const shifts = [shift('past', -10), shift('soon', 30), shift('edge', 60), shift('far', 120)];
      const due = svc.selectDueShifts(shifts, NOW, 60, new Set());
      expect(due.map((s) => s.id)).toEqual(['soon', 'edge']);
    });

    it('excludes already-reminded shifts', () => {
      const shifts = [shift('soon', 30)];
      const due = svc.selectDueShifts(shifts, NOW, 60, new Set(['soon']));
      expect(due).toHaveLength(0);
    });
  });

  describe('normalizeShifts (defensive mapping)', () => {
    const svc = new ShiftReminderService(cfg({}), tw, notif);
    it('maps varied field names and drops invalid rows', () => {
      const raw = {
        shifts: [
          { shift_id: 's1', start_at: NOW.toISOString(), employee_name: 'Jean', employee_phone: '+33' },
          { id: 's2', startsAt: NOW.toISOString(), employeeEmail: 'a@b.com' },
          { id: 'bad', start: 'not-a-date' },
          { startsAt: NOW.toISOString() }, // no id → dropped
        ],
      };
      const out = svc.normalizeShifts(raw);
      expect(out.map((s) => s.id)).toEqual(['s1', 's2']);
      expect(out[0].phone).toBe('+33');
      expect(out[1].email).toBe('a@b.com');
    });
  });

  describe('isEnabled gating', () => {
    it('disabled unless flag set AND a channel is configured', () => {
      const off = new ShiftReminderService(cfg({ SHIFT_REMINDERS_ENABLED: 'true' }), tw, notif);
      expect(off.isEnabled()).toBe(false); // no channel
      const on = new ShiftReminderService(
        cfg({ SHIFT_REMINDERS_ENABLED: 'true' }),
        tw,
        { smsEnabled: true, emailEnabled: false, notify: jest.fn() } as unknown as NotificationService,
      );
      expect(on.isEnabled()).toBe(true);
    });
  });

  describe('runReminderSweep', () => {
    it('notifies due shifts once and dedupes on a second sweep', async () => {
      const notifyMock = jest.fn().mockResolvedValue({ ok: true, skipped: false, provider: 'twilio' });
      const twMock = {
        fetchStores: jest.fn().mockResolvedValue([{ id: 'store-1' }]),
        getTodayShifts: jest.fn().mockResolvedValue({
          shifts: [{ id: 's1', startsAt: new Date(NOW.getTime() + 20 * 60_000).toISOString(), employeePhone: '+33' }],
        }),
      } as unknown as TimewinService;
      const svc = new ShiftReminderService(
        cfg({ SHIFT_REMINDERS_ENABLED: 'true', SHIFT_REMINDER_LOOKAHEAD_MIN: '60' }),
        twMock,
        { smsEnabled: true, emailEnabled: false, notify: notifyMock } as unknown as NotificationService,
      );

      const first = await svc.runReminderSweep(NOW);
      expect(first.reminded).toBe(1);
      expect(notifyMock).toHaveBeenCalledTimes(1);

      const second = await svc.runReminderSweep(NOW);
      expect(second.reminded).toBe(0); // deduped
      expect(notifyMock).toHaveBeenCalledTimes(1);
    });

    it('degrades gracefully when TimeWin24 is unreachable', async () => {
      const twMock = { fetchStores: jest.fn().mockRejectedValue(new Error('TW24 down')) } as unknown as TimewinService;
      const svc = new ShiftReminderService(cfg({}), twMock, notif);
      const res = await svc.runReminderSweep(NOW);
      expect(res).toEqual({ stores: 0, reminded: 0 });
    });
  });
});

// P292 (bloc B5) — TD-055 wiring: quiet hours / holidays actually suppress the sweep.
describe('quiet hours & holidays wiring (POS-055 / TD-055)', () => {
  const tw = { fetchStores: jest.fn().mockResolvedValue([]) } as unknown as TimewinService;
  const notif = { smsEnabled: true, emailEnabled: false, notify: jest.fn() } as unknown as NotificationService;

  it('default config (no env) = empty window → NEVER suppressed (zero behavior change)', () => {
    const svc = new ShiftReminderService(cfg({}), tw, notif);
    for (let h = 0; h < 24; h++) {
      expect(svc.isSuppressed(new Date(Date.UTC(2026, 5, 8, h)))).toBe(false);
    }
  });

  it('suppresses inside a midnight-wrapping quiet window (21h→8h) and not outside', () => {
    const svc = new ShiftReminderService(
      cfg({ SHIFT_REMINDER_QUIET_START_HOUR: '21', SHIFT_REMINDER_QUIET_END_HOUR: '8' }),
      tw,
      notif,
    );
    const at = (h: number) => { const d = new Date('2026-06-08T00:00:00'); d.setHours(h); return d; };
    expect(svc.isSuppressed(at(23))).toBe(true);
    expect(svc.isSuppressed(at(3))).toBe(true);
    expect(svc.isSuppressed(at(12))).toBe(false);
  });

  it('suppresses on a configured holiday (ISO list), ignores malformed entries', () => {
    const svc = new ShiftReminderService(
      cfg({ SHIFT_REMINDER_HOLIDAYS_ISO: '2026-07-14, not-a-date, 2026-12-25' }),
      tw,
      notif,
    );
    expect(svc.isSuppressed(new Date('2026-07-14T10:00:00Z'))).toBe(true);
    expect(svc.isSuppressed(new Date('2026-07-15T10:00:00Z'))).toBe(false);
  });

  it('a suppressed sweep sends nothing and does not even call TimeWin24', async () => {
    const twSpy = { fetchStores: jest.fn().mockResolvedValue([{ id: 's1' }]) } as unknown as TimewinService;
    const svc = new ShiftReminderService(
      cfg({ SHIFT_REMINDER_QUIET_START_HOUR: '0', SHIFT_REMINDER_QUIET_END_HOUR: '24' }),
      twSpy,
      notif,
    );
    const report = await svc.runReminderSweep(new Date('2026-06-08T12:00:00'));
    expect(report).toEqual({ stores: 0, reminded: 0 });
    expect((twSpy as any).fetchStores).not.toHaveBeenCalled();
  });
});
