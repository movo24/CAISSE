/**
 * Wesley Control — pure KPI aggregators for the direction mobile API (read-only).
 * No I/O here: every function is deterministic and unit-tested. All money is
 * integer minor units (centimes) — never floats on amounts; percentages are the
 * only decimals and are rounded to 1 decimal.
 */

export interface PeriodTotals {
  revenueMinorUnits: number;
  transactionCount: number;
  averageBasketMinorUnits: number;
}

export interface StoreDayRow {
  storeId: string;
  revenueMinorUnits: number;
  transactionCount: number;
}

export interface HourlyRow {
  hour: number;
  revenueMinorUnits: number;
  transactionCount: number;
}

export interface RankedStore {
  storeId: string;
  name: string;
  revenueMinorUnits: number;
}

/** Integer average basket — 0 when no transaction (never NaN). */
export function averageBasketMinorUnits(
  revenueMinorUnits: number,
  transactionCount: number,
): number {
  return transactionCount > 0
    ? Math.round(revenueMinorUnits / transactionCount)
    : 0;
}

export function toPeriodTotals(
  revenueMinorUnits: number,
  transactionCount: number,
): PeriodTotals {
  return {
    revenueMinorUnits,
    transactionCount,
    averageBasketMinorUnits: averageBasketMinorUnits(
      revenueMinorUnits,
      transactionCount,
    ),
  };
}

/**
 * Percentage variation current vs previous, rounded to 1 decimal.
 * `null` (not 0, not Infinity) when the previous period is empty — the UI must
 * display "—", never a fake number.
 */
export function variationPct(current: number, previous: number): number | null {
  if (previous <= 0) return null;
  return Math.round(((current - previous) / previous) * 1000) / 10;
}

/** Sum per-store day rows into network totals. */
export function sumStoreRows(rows: StoreDayRow[]): {
  revenueMinorUnits: number;
  transactionCount: number;
} {
  return rows.reduce(
    (acc, r) => ({
      revenueMinorUnits: acc.revenueMinorUnits + r.revenueMinorUnits,
      transactionCount: acc.transactionCount + r.transactionCount,
    }),
    { revenueMinorUnits: 0, transactionCount: 0 },
  );
}

/**
 * Best/worst stores by revenue (desc). Stores with zero revenue still rank —
 * a store at 0 € is exactly what the direction wants to see in "worst".
 */
export function rankStores(
  rows: RankedStore[],
  take = 3,
): { best: RankedStore[]; worst: RankedStore[] } {
  const sorted = [...rows].sort(
    (a, b) => b.revenueMinorUnits - a.revenueMinorUnits,
  );
  return {
    best: sorted.slice(0, take),
    worst: sorted.length <= take ? [] : sorted.slice(-take).reverse(),
  };
}

/**
 * Margin rate in % (1 decimal) — `null` when revenue is 0 or margin unknown
 * (cost prices missing), so the UI shows "—" instead of a fake 0%.
 */
export function marginRate(
  marginMinorUnits: number | null,
  revenueMinorUnits: number,
): number | null {
  if (marginMinorUnits === null || revenueMinorUnits <= 0) return null;
  return Math.round((marginMinorUnits / revenueMinorUnits) * 1000) / 10;
}

/** Fill sparse hourly rows into a dense 24-slot series (0..23). */
export function fillHourly(rows: HourlyRow[]): HourlyRow[] {
  const byHour = new Map(rows.map((r) => [r.hour, r]));
  return Array.from({ length: 24 }, (_, hour) => {
    const r = byHour.get(hour);
    return {
      hour,
      revenueMinorUnits: r?.revenueMinorUnits ?? 0,
      transactionCount: r?.transactionCount ?? 0,
    };
  });
}

/** Parse a raw SQL count/sum (string | number | null) into a safe integer. */
export function toInt(value: unknown): number {
  const n = typeof value === 'string' ? parseInt(value, 10) : Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}
