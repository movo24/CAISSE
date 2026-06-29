import { summarizeShifts, toShiftEvents, shiftsToCsv, ShiftEvent } from './shift-amplitude';

const open = (sessionId: string, employeeId: string, at: string, terminalId: string | null = 'T1'): ShiftEvent => ({
  sessionId, employeeId, terminalId, kind: 'open', at,
});
const close = (sessionId: string, employeeId: string, at: string, durationMinutes?: number | null): ShiftEvent => ({
  sessionId, employeeId, terminalId: 'T1', kind: 'close', at, durationMinutes,
});

describe('shift-amplitude (POS-INT-106)', () => {
  it('pairs open+close into a closed shift with duration', () => {
    const s = summarizeShifts([
      open('s1', 'emp1', '2026-06-29T09:00:00.000Z'),
      close('s1', 'emp1', '2026-06-29T17:00:00.000Z', 480),
    ]);
    expect(s.shifts).toHaveLength(1);
    expect(s.shifts[0]).toMatchObject({
      sessionId: 's1', employeeId: 'emp1', open: false, durationMinutes: 480,
    });
    expect(s.totalMinutes).toBe(480);
  });

  it('falls back to closedAt-openedAt when no explicit duration', () => {
    const s = summarizeShifts([
      open('s1', 'emp1', '2026-06-29T09:00:00.000Z'),
      close('s1', 'emp1', '2026-06-29T09:30:00.000Z', null),
    ]);
    expect(s.shifts[0].durationMinutes).toBe(30);
  });

  it('marks an unmatched open as still on shift (duration 0)', () => {
    const s = summarizeShifts([open('s1', 'emp1', '2026-06-29T09:00:00.000Z')]);
    expect(s.shifts[0]).toMatchObject({ open: true, durationMinutes: 0, closedAt: null });
  });

  it('handles close arriving before its open is known (out-of-order)', () => {
    const s = summarizeShifts([
      close('s1', 'emp1', '2026-06-29T17:00:00.000Z', null),
      open('s1', 'emp1', '2026-06-29T09:00:00.000Z'),
    ]);
    expect(s.shifts[0]).toMatchObject({ open: false, durationMinutes: 480 });
  });

  it('aggregates per employee, ranked by total minutes', () => {
    const s = summarizeShifts([
      open('s1', 'emp1', '2026-06-29T09:00:00.000Z'), close('s1', 'emp1', '2026-06-29T12:00:00.000Z', 180),
      open('s2', 'emp1', '2026-06-29T13:00:00.000Z'), close('s2', 'emp1', '2026-06-29T17:00:00.000Z', 240),
      open('s3', 'emp2', '2026-06-29T09:00:00.000Z'), close('s3', 'emp2', '2026-06-29T10:00:00.000Z', 60),
    ]);
    expect(s.byEmployee).toEqual([
      { employeeId: 'emp1', shiftCount: 2, totalMinutes: 420 },
      { employeeId: 'emp2', shiftCount: 1, totalMinutes: 60 },
    ]);
    expect(s.totalMinutes).toBe(480);
  });

  describe('toShiftEvents', () => {
    it('extracts open + close from outbox rows, ignoring other types', () => {
      const rows = [
        { type: 'cash_session.opened', employeeId: 'emp1', terminalId: 'T1', occurredAt: 'x',
          payload: { sessionId: 's1', openedAt: '2026-06-29T09:00:00.000Z' } },
        { type: 'employee_activity.recorded', employeeId: 'emp1', terminalId: 'T1',
          payload: { sessionId: 's1', action: 'closed', closedAt: '2026-06-29T17:00:00.000Z', durationMinutes: 480 } },
        { type: 'employee_activity.recorded', employeeId: 'emp1',
          payload: { sessionId: 's1', action: 'opened' } }, // not a close → ignored
        { type: 'sale.completed', payload: { ticketNumber: 'T-1' } }, // unrelated
      ];
      const ev = toShiftEvents(rows);
      expect(ev.map((e) => e.kind)).toEqual(['open', 'close']);
      const s = summarizeShifts(ev);
      expect(s.shifts[0].durationMinutes).toBe(480);
    });

    it('skips rows without a session id', () => {
      expect(toShiftEvents([{ type: 'cash_session.opened', payload: {} }])).toEqual([]);
    });
  });

  describe('shiftsToCsv (POS-INT-109)', () => {
    it('emits a stable header + one row per shift', () => {
      const s = summarizeShifts([
        open('s1', 'emp1', '2026-06-29T09:00:00.000Z'),
        close('s1', 'emp1', '2026-06-29T17:00:00.000Z', 480),
        open('s2', 'emp2', '2026-06-29T10:00:00.000Z'),
      ]);
      const csv = shiftsToCsv(s).split('\n');
      expect(csv[0]).toBe('sessionId,employeeId,terminalId,openedAt,closedAt,durationMinutes,open');
      expect(csv).toHaveLength(3); // header + 2 shifts
      expect(csv[1]).toBe('s1,emp1,T1,2026-06-29T09:00:00.000Z,2026-06-29T17:00:00.000Z,480,false');
      expect(csv[2]).toContain('s2,emp2,T1,2026-06-29T10:00:00.000Z,,0,true');
    });

    it('header-only when there are no shifts', () => {
      expect(shiftsToCsv(summarizeShifts([]))).toBe(
        'sessionId,employeeId,terminalId,openedAt,closedAt,durationMinutes,open',
      );
    });
  });
});
