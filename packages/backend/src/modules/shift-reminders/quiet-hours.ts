/**
 * POS-055 — Quiet hours & holidays (pure, unit-testable).
 *
 * Suppresses reminders/alerts during quiet windows and on holidays.
 * WIRED into the reminder sweep since P292 (`shift-reminder.service.isSilentNow`,
 * env: SHIFT_REMINDER_QUIET_START_HOUR / _END_HOUR / SHIFT_REMINDER_HOLIDAYS ;
 * défaut = fenêtre vide → jamais supprimé, zéro changement de comportement).
 * TD-055-QUIET-HOURS-WIRING : clos.
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
