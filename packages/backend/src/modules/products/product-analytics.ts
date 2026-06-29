/**
 * POS — Product per-period analytics math (pure, unit-testable). Integer centimes.
 * Extracted from ProductsService price-period analytics (behavior-preserving):
 * period length, per-day rates, margin %, and period-over-period delta %.
 */

/** Period length in whole days, at least 1 (ceil of the ms span). */
export function periodDays(fromMs: number, toMs: number): number {
  return Math.max(1, Math.ceil((toMs - fromMs) / (1000 * 60 * 60 * 24)));
}

/** Units sold per day, rounded to 2 decimals. */
export function unitsPerDayRate(unitsSold: number, days: number): number {
  return Math.round((unitsSold / days) * 100) / 100;
}

/** A minor-unit value spread per day (rounded to integer centimes). */
export function perDayMinor(valueMinorUnits: number, days: number): number {
  return Math.round(valueMinorUnits / days);
}

/** Margin % from price/cost (2 decimals); null when price ≤ 0. */
export function marginPercentOf(priceMinorUnits: number, costMinorUnits: number): number | null {
  if (priceMinorUnits <= 0) return null;
  return Math.round(((priceMinorUnits - costMinorUnits) / priceMinorUnits) * 10000) / 100;
}

/** Period-over-period delta % (2 decimals); null when previous is 0. */
export function deltaPct(current: number, previous: number): number | null {
  if (previous === 0) return null;
  return Math.round(((current - previous) / previous) * 10000) / 100;
}
