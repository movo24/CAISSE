/**
 * POS — Hourly temporal pattern math (pure, unit-testable). Integer centimes.
 * Extracted from SalesAiService hourly-pattern analysis (behavior-preserving):
 * per-day averages, average basket, and rush-hour detection.
 */

export const RUSH_THRESHOLD_MULTIPLIER = 1.5;

/** Average tickets per day, rounded to 1 decimal. */
export function avgTicketsPerDay(tickets: number, days: number): number {
  return Math.round((tickets / days) * 10) / 10;
}

/** Average revenue per day (integer centimes). */
export function avgRevenuePerDay(revenueMinorUnits: number, days: number): number {
  return Math.round(revenueMinorUnits / days);
}

/** Average basket (revenue per ticket, integer centimes); 0 when no tickets. */
export function avgBasket(revenueMinorUnits: number, tickets: number): number {
  return tickets > 0 ? Math.round(revenueMinorUnits / tickets) : 0;
}

/** Rush threshold: the global mean scaled by the rush multiplier. */
export function rushThreshold(
  avgTicketsGlobal: number,
  hourCount: number,
  multiplier: number = RUSH_THRESHOLD_MULTIPLIER,
): number {
  return (avgTicketsGlobal / hourCount) * multiplier;
}

/** True when this hour's tickets/day exceeds the rush threshold. */
export function isRush(ticketsPerDay: number, threshold: number): boolean {
  return ticketsPerDay > threshold;
}
