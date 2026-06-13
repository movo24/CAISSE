/**
 * Wall-clock utilities over IANA timezones (A1 ratified): the store's timezone
 * is a FACT carried by the analytics.store_clock datum; these helpers interpret
 * instants in that zone — beats, store_closed_late, the cockpit business day and
 * quiet hours all evaluate through here. DST is absorbed by the IANA zone (the
 * decisive property: the same WALL hour on either side of a DST flip behaves the
 * same, whatever the UTC offset).
 *
 * Pure Intl — no timezone library dependency. Node ships full ICU.
 */

const FMT_CACHE = new Map<string, Intl.DateTimeFormat>();

function fmtFor(timeZone: string): Intl.DateTimeFormat {
  let f = FMT_CACHE.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    });
    FMT_CACHE.set(timeZone, f);
  }
  return f;
}

interface ZonedParts {
  y: number;
  m: number;
  d: number;
  h: number;
  min: number;
}

function partsInZone(date: Date, timeZone: string): ZonedParts {
  const parts = fmtFor(timeZone).formatToParts(date);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? NaN);
  return { y: get('year'), m: get('month'), d: get('day'), h: get('hour'), min: get('minute') };
}

/** The local calendar day (YYYY-MM-DD) of an instant in the given zone. */
export function localDayString(date: Date, timeZone: string): string {
  const p = partsInZone(date, timeZone);
  return `${p.y}-${String(p.m).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`;
}

/** The local wall-clock hour (0–23) of an instant in the given zone. */
export function localHourOf(date: Date, timeZone: string): number {
  return partsInZone(date, timeZone).h;
}

/** Minutes since local midnight (0–1439) — for wall-clock threshold compares. */
export function localMinutesOfDay(date: Date, timeZone: string): number {
  const p = partsInZone(date, timeZone);
  return p.h * 60 + p.min;
}

/** Calendar-day arithmetic on YYYY-MM-DD strings (zone-free by construction). */
export function shiftDayString(day: string, delta: number): string {
  const [y, m, d] = day.split('-').map(Number);
  const x = new Date(Date.UTC(y, m - 1, d));
  x.setUTCDate(x.getUTCDate() + delta);
  return x.toISOString().slice(0, 10);
}

/**
 * The UTC instants bounding a LOCAL calendar day [start, end) in the given zone.
 * DST-correct: a spring-forward day is 23h long, a fall-back day 25h. Two-pass
 * fixed-point refinement (midnight is never inside a Paris DST transition).
 */
export function localDayRange(day: string, timeZone: string): { start: Date; end: Date } {
  return { start: utcInstantOfLocalMidnight(day, timeZone), end: utcInstantOfLocalMidnight(shiftDayString(day, 1), timeZone) };
}

function utcInstantOfLocalMidnight(day: string, timeZone: string): Date {
  const [y, m, d] = day.split('-').map(Number);
  const want = Date.UTC(y, m - 1, d, 0, 0);
  let ts = want; // first guess: local == UTC
  for (let i = 0; i < 2; i++) {
    const got = partsInZone(new Date(ts), timeZone);
    const gotTs = Date.UTC(got.y, got.m - 1, got.d, got.h, got.min);
    ts += want - gotTs;
  }
  return new Date(ts);
}
