/**
 * POS — Comptamax journal date-range bounds (pure, unit-testable).
 * Produces UTC [start, end) half-open intervals from YYYY-MM-DD inputs, for a
 * single day or an inclusive range (period close). Invalid input throws.
 */

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function parseUtcDay(date: string): Date {
  if (!DATE_RE.test(date)) throw new Error(`invalid date (expected YYYY-MM-DD): ${date}`);
  const d = new Date(`${date}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime())) throw new Error(`invalid date: ${date}`);
  return d;
}

/** Half-open [00:00 of date, 00:00 of next day). */
export function dayRangeUtc(date: string): { start: Date; end: Date } {
  const start = parseUtcDay(date);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 1);
  return { start, end };
}

/** Half-open [00:00 of `from`, 00:00 of day after `to`] — inclusive of both days. */
export function inclusiveRangeUtc(from: string, to: string): { start: Date; end: Date } {
  const start = parseUtcDay(from);
  const toDay = parseUtcDay(to);
  if (toDay.getTime() < start.getTime()) throw new Error(`range end before start: ${from}..${to}`);
  const end = new Date(toDay);
  end.setUTCDate(end.getUTCDate() + 1);
  return { start, end };
}
