import {
  intervalMinutes,
  sumWorkedMinutes,
  reconcilePresence,
  DEFAULT_TOLERANCE_MINUTES,
} from './presence-reconciliation';

const at = (h: number, m = 0) => new Date(Date.UTC(2026, 5, 29, h, m, 0)).toISOString();

describe('POS↔TimeWin presence-reconciliation', () => {
  describe('intervalMinutes', () => {
    it('computes whole minutes', () => {
      expect(intervalMinutes({ start: at(9), end: at(17) })).toBe(480);
    });
    it('0 for open-ended or negative', () => {
      expect(intervalMinutes({ start: at(9), end: null })).toBe(0);
      expect(intervalMinutes({ start: at(17), end: at(9) })).toBe(0);
    });
  });

  it('sumWorkedMinutes adds intervals', () => {
    expect(sumWorkedMinutes([{ start: at(9), end: at(12) }, { start: at(13), end: at(17) }])).toBe(
      180 + 240,
    );
  });

  it('within tolerance → no anomaly', () => {
    const r = reconcilePresence({
      posSessions: [{ start: at(9), end: at(17) }],
      timewinShifts: [{ start: at(9), end: at(17, 10) }],
    });
    expect(r.posMinutes).toBe(480);
    expect(r.timewinMinutes).toBe(490);
    expect(r.deltaMinutes).toBe(-10);
    expect(r.withinTolerance).toBe(true);
    expect(r.anomalies).toEqual([]);
    expect(DEFAULT_TOLERANCE_MINUTES).toBe(15);
  });

  it('flags pos_without_timewin', () => {
    const r = reconcilePresence({ posSessions: [{ start: at(9), end: at(12) }], timewinShifts: [] });
    expect(r.anomalies).toContain('pos_without_timewin');
    expect(r.anomalies).toContain('delta_exceeds_tolerance');
  });

  it('flags timewin_without_pos', () => {
    const r = reconcilePresence({ posSessions: [], timewinShifts: [{ start: at(9), end: at(12) }] });
    expect(r.anomalies).toContain('timewin_without_pos');
  });

  it('flags open_pos_session', () => {
    const r = reconcilePresence({
      posSessions: [{ start: at(9), end: null }],
      timewinShifts: [{ start: at(9), end: at(17) }],
    });
    expect(r.anomalies).toContain('open_pos_session');
  });

  it('flags delta_exceeds_tolerance beyond threshold', () => {
    const r = reconcilePresence({
      posSessions: [{ start: at(9), end: at(17) }],
      timewinShifts: [{ start: at(9), end: at(15) }],
      toleranceMinutes: 30,
    });
    expect(r.deltaMinutes).toBe(120);
    expect(r.withinTolerance).toBe(false);
    expect(r.anomalies).toContain('delta_exceeds_tolerance');
  });
});
