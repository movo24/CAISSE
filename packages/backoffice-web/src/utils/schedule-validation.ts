/**
 * Client-side MIRROR of the server schedule validation (UX only — the server
 * re-validates and is the guarantee). Same rules: HH:MM, open < close on open
 * days. Returns French messages keyed by dayOfWeek; empty map = valid.
 */
export interface ScheduleDayInput {
  dayOfWeek: number;
  closed: boolean;
  openTime?: string | null;
  closeTime?: string | null;
}

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

export function validateScheduleDays(days: ScheduleDayInput[]): Record<number, string> {
  const errors: Record<number, string> = {};
  for (const d of days) {
    if (d.closed) continue;
    if (!d.openTime || !HHMM.test(d.openTime) || !d.closeTime || !HHMM.test(d.closeTime)) {
      errors[d.dayOfWeek] = 'Heures attendues au format HH:MM';
      continue;
    }
    if (d.openTime >= d.closeTime) {
      errors[d.dayOfWeek] = `L'ouverture (${d.openTime}) doit précéder la fermeture (${d.closeTime})`;
    }
  }
  return errors;
}
