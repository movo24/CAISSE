/**
 * POS ↔ TimeWin24 — presence reconciliation (pure, unit-testable).
 *
 * Compares worked time observed at the caisse (POS sessions: open→close) with
 * TimeWin24 presence (pointage shifts: clock-in→clock-out) for one employee/day,
 * and flags discrepancies useful for HR / payroll pre-accounting.
 * No DB, no side effects — a service/cron feeds it both lists.
 */

export interface WorkInterval {
  start: Date | string;
  end: Date | string | null;
}

const MINUTE_MS = 60_000;

/** Whole minutes of an interval (0 when open-ended or negative). */
export function intervalMinutes(i: WorkInterval): number {
  if (!i.end) return 0;
  const ms = new Date(i.end).getTime() - new Date(i.start).getTime();
  return ms > 0 ? Math.floor(ms / MINUTE_MS) : 0;
}

/** Sum of worked minutes over a set of intervals. */
export function sumWorkedMinutes(intervals: WorkInterval[]): number {
  return intervals.reduce((acc, i) => acc + intervalMinutes(i), 0);
}

export type ReconcileAnomaly =
  | 'pos_without_timewin' // caisse activity but no TimeWin presence
  | 'timewin_without_pos' // TimeWin presence but no caisse session
  | 'open_pos_session' // a POS session never closed
  | 'delta_exceeds_tolerance'; // worked-time gap beyond tolerance

export interface ReconcileResult {
  posMinutes: number;
  timewinMinutes: number;
  deltaMinutes: number; // pos - timewin (signed)
  withinTolerance: boolean;
  anomalies: ReconcileAnomaly[];
}

export const DEFAULT_TOLERANCE_MINUTES = 15;

/** Reconcile POS sessions vs TimeWin shifts for one employee/day. */
export function reconcilePresence(input: {
  posSessions: WorkInterval[];
  timewinShifts: WorkInterval[];
  toleranceMinutes?: number;
}): ReconcileResult {
  const tolerance = input.toleranceMinutes ?? DEFAULT_TOLERANCE_MINUTES;
  const posMinutes = sumWorkedMinutes(input.posSessions);
  const timewinMinutes = sumWorkedMinutes(input.timewinShifts);
  const deltaMinutes = posMinutes - timewinMinutes;

  const anomalies: ReconcileAnomaly[] = [];
  if (posMinutes > 0 && timewinMinutes === 0) anomalies.push('pos_without_timewin');
  if (timewinMinutes > 0 && posMinutes === 0) anomalies.push('timewin_without_pos');
  if (input.posSessions.some((s) => !s.end)) anomalies.push('open_pos_session');
  const withinTolerance = Math.abs(deltaMinutes) <= tolerance;
  if (!withinTolerance) anomalies.push('delta_exceeds_tolerance');

  return { posMinutes, timewinMinutes, deltaMinutes, withinTolerance, anomalies };
}
