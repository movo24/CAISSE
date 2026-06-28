/**
 * POS-055 — Quiet hours & holidays (pure, unit-testable).
 *
 * Foundation for suppressing reminders/alerts during quiet windows and on holidays.
 * NOT yet wired into the reminder sweep (the exact quiet window + holiday calendar are a
 * configuration/product decision) — see TECHNICAL_DEBT TD-055-QUIET-HOURS-WIRING.
 */

/**
 * True when `hour` (0-23) falls inside [startHour, endHour). Supports windows that wrap
 * across midnight (e.g. 21 → 8 means 21:00-23:59 and 00:00-07:59).
 */
export function isQuietHour(hour: number, startHour: number, endHour: number): boolean {
  if (startHour === endHour) return false; // empty window
  if (startHour < endHour) {
    return hour >= startHour && hour < endHour;
  }
  // wraps midnight
  return hour >= startHour || hour < endHour;
}

/** True when the date (YYYY-MM-DD) is in the provided holiday set. */
export function isHoliday(date: Date, holidaysISO: Set<string>): boolean {
  const iso = date.toISOString().slice(0, 10);
  return holidaysISO.has(iso);
}
