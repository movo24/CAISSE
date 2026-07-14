/**
 * POS — Customer visit frequency analytics (pure, unit-testable).
 * Computes visit count, first/last visit, mean interval, recency and a segment.
 *
 * Segment thresholds are DEFAULTS (product-tunable): `regularMaxIntervalDays` (a customer
 * visiting at least this often is "regular") and `atRiskMultiplier` (silent for more than
 * this × their usual interval → "at_risk"). No DB, deterministic given `now`.
 */
export type VisitSegment = 'unknown' | 'new' | 'regular' | 'occasional' | 'at_risk';

export interface VisitFrequency {
  visitCount: number;
  firstVisit: string | null;
  lastVisit: string | null;
  averageIntervalDays: number | null;
  daysSinceLastVisit: number | null;
  segment: VisitSegment;
}

const DAY_MS = 1000 * 60 * 60 * 24;

export function computeVisitFrequency(
  visitDates: (Date | string)[],
  now: Date = new Date(),
  opts: { regularMaxIntervalDays?: number; atRiskMultiplier?: number } = {},
): VisitFrequency {
  const regularMax = opts.regularMaxIntervalDays ?? 14;
  const atRiskMult = opts.atRiskMultiplier ?? 2;

  const times = visitDates
    .map((d) => new Date(d).getTime())
    .filter((t) => !Number.isNaN(t))
    .sort((a, b) => a - b);

  if (times.length === 0) {
    return {
      visitCount: 0,
      firstVisit: null,
      lastVisit: null,
      averageIntervalDays: null,
      daysSinceLastVisit: null,
      segment: 'unknown',
    };
  }

  const first = times[0];
  const last = times[times.length - 1];
  const daysSinceLast = Math.floor((now.getTime() - last) / DAY_MS);

  if (times.length === 1) {
    return {
      visitCount: 1,
      firstVisit: new Date(first).toISOString(),
      lastVisit: new Date(last).toISOString(),
      averageIntervalDays: null,
      daysSinceLastVisit: daysSinceLast,
      segment: 'new',
    };
  }

  const avgIntervalDays = (last - first) / (times.length - 1) / DAY_MS;
  let segment: VisitSegment;
  if (avgIntervalDays > 0 && daysSinceLast > atRiskMult * avgIntervalDays) {
    segment = 'at_risk';
  } else if (avgIntervalDays <= regularMax) {
    segment = 'regular';
  } else {
    segment = 'occasional';
  }

  return {
    visitCount: times.length,
    firstVisit: new Date(first).toISOString(),
    lastVisit: new Date(last).toISOString(),
    averageIntervalDays: Math.round(avgIntervalDays * 100) / 100,
    daysSinceLastVisit: daysSinceLast,
    segment,
  };
}
