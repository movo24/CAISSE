/**
 * Reports date-range helpers (pure, unit-testable).
 *
 * Drives the Reports screen's period selection: quick presets, validation,
 * single-day vs range detection, and human titles. All dates are ISO
 * `YYYY-MM-DD` strings (string comparison is safe for ordering).
 */

export type RangePreset =
  | 'today'
  | 'yesterday'
  | 'last7'
  | 'thisMonth'
  | 'lastMonth'
  | 'custom';

export const RANGE_PRESETS: { id: RangePreset; label: string }[] = [
  { id: 'today', label: "Aujourd'hui" },
  { id: 'yesterday', label: 'Hier' },
  { id: 'last7', label: '7 derniers jours' },
  { id: 'thisMonth', label: 'Mois en cours' },
  { id: 'lastMonth', label: 'Mois précédent' },
  { id: 'custom', label: 'Période personnalisée' },
];

/** Local YYYY-MM-DD for a Date (uses local calendar components). */
export function toIso(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function addDays(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
}

/** Resolve a preset to an inclusive {start, end} range relative to `today`. */
export function computePreset(preset: RangePreset, today: Date): { start: string; end: string } {
  const t = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  switch (preset) {
    case 'today':
      return { start: toIso(t), end: toIso(t) };
    case 'yesterday': {
      const y = addDays(t, -1);
      return { start: toIso(y), end: toIso(y) };
    }
    case 'last7':
      return { start: toIso(addDays(t, -6)), end: toIso(t) }; // 7 days inclusive
    case 'thisMonth': {
      const first = new Date(t.getFullYear(), t.getMonth(), 1);
      return { start: toIso(first), end: toIso(t) };
    }
    case 'lastMonth': {
      const first = new Date(t.getFullYear(), t.getMonth() - 1, 1);
      const last = new Date(t.getFullYear(), t.getMonth(), 0); // day 0 = last day of prev month
      return { start: toIso(first), end: toIso(last) };
    }
    case 'custom':
    default:
      return { start: toIso(t), end: toIso(t) };
  }
}

const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isIsoDate(s: string): boolean {
  return typeof s === 'string' && ISO_RE.test(s);
}

/** Valid when both are ISO dates and end >= start. */
export function isRangeValid(start: string, end: string): boolean {
  return isIsoDate(start) && isIsoDate(end) && end >= start;
}

export function isSingleDay(start: string, end: string): boolean {
  return start === end;
}

/** ISO YYYY-MM-DD → FR DD/MM/YYYY. Returns the input unchanged if not ISO. */
export function frDate(iso: string): string {
  if (!isIsoDate(iso)) return iso;
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

/** "Rapport du 06/07/2026" (single day) or "Rapport du 01/07/2026 au 06/07/2026". */
export function rangeTitle(start: string, end: string): string {
  if (isSingleDay(start, end)) return `Rapport du ${frDate(start)}`;
  return `Rapport du ${frDate(start)} au ${frDate(end)}`;
}

/** Which preset (if any) currently matches the selected range. */
export function matchPreset(start: string, end: string, today: Date): RangePreset {
  for (const { id } of RANGE_PRESETS) {
    if (id === 'custom') continue;
    const r = computePreset(id, today);
    if (r.start === start && r.end === end) return id;
  }
  return 'custom';
}
