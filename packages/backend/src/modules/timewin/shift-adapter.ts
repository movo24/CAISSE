/**
 * TimeWin24 shift/pointage → WorkInterval adapter (pure, unit-testable, defensive).
 *
 * TW24 feeds are `any` (shape varies by version). This normalizes whatever it
 * returns into the WorkInterval[] the reconciliation engine consumes, tolerating
 * common field names. Unknown / malformed input degrades to [] (never throws) so
 * reconciliation stays non-blocking.
 */
import type { WorkInterval } from './presence-reconciliation';

function pick(obj: any, keys: string[]): unknown {
  for (const k of keys) {
    if (obj && obj[k] != null) return obj[k];
  }
  return null;
}

/** Extract the array of shifts from common envelope shapes. */
function asArray(raw: any): any[] {
  if (Array.isArray(raw)) return raw;
  if (Array.isArray(raw?.shifts)) return raw.shifts;
  if (Array.isArray(raw?.data)) return raw.data;
  if (Array.isArray(raw?.pointages)) return raw.pointages;
  return [];
}

const START_KEYS = ['start', 'startedAt', 'clockIn', 'clock_in', 'in', 'checkIn', 'debut'];
const END_KEYS = ['end', 'endedAt', 'clockOut', 'clock_out', 'out', 'checkOut', 'fin'];

/** Normalize a TW24 shifts payload into WorkInterval[] (items without a start are dropped). */
export function toWorkIntervals(raw: unknown): WorkInterval[] {
  return asArray(raw)
    .map((item): WorkInterval | null => {
      const start = pick(item, START_KEYS);
      const end = pick(item, END_KEYS);
      return start
        ? { start: start as string | Date, end: (end as string | Date | null) ?? null }
        : null;
    })
    .filter((i): i is WorkInterval => i !== null);
}
