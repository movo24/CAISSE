/**
 * Cockpit — pure display helpers. Every number shown by the cockpit comes from
 * the API (which derives from analytics.*) — these helpers only FORMAT, they
 * never compute a business figure (INV-3 stays server-side).
 */

/** Integer centimes → "1 234,56 €" (French display); null/undefined → em dash. */
export function eurosFromMinor(minor: number | null | undefined): string {
  if (minor == null) return '—';
  const sign = minor < 0 ? '-' : '';
  const abs = Math.abs(minor);
  const units = Math.trunc(abs / 100).toLocaleString('fr-FR').replace(/ /g, ' ');
  const cents = String(abs % 100).padStart(2, '0');
  return `${sign}${units},${cents} €`;
}

/** Percentage value already computed server-side → "61,7 %"; null → em dash. */
export function pctLabel(pct: number | null | undefined): string {
  if (pct == null) return '—';
  return `${String(pct).replace('.', ',')} %`;
}

/** computed_at → honest freshness label ("à l'instant", "il y a 12 min", …). */
export function freshnessLabel(iso: string | null | undefined, now: Date = new Date()): string {
  if (!iso) return 'fraîcheur inconnue';
  const ms = now.getTime() - new Date(iso).getTime();
  if (Number.isNaN(ms)) return 'fraîcheur inconnue';
  const min = Math.floor(ms / 60_000);
  if (min < 1) return 'à l’instant';
  if (min < 60) return `il y a ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `il y a ${h} h`;
  return `le ${new Date(iso).toLocaleDateString('fr-FR')}`;
}

/**
 * Quiet-hours form validation — mirrors the server rule exactly (both-or-neither,
 * integers 0–23). Returns the error message, or null when valid. The server
 * re-validates regardless (the client mirror is convenience, not the guarantee).
 */
export function validateQuietHours(start: number | null, end: number | null): string | null {
  const validHour = (h: number | null) => h === null || (Number.isInteger(h) && h >= 0 && h <= 23);
  if (!validHour(start) || !validHour(end)) return 'Les heures doivent être des entiers entre 0 et 23.';
  if ((start === null) !== (end === null)) return 'Renseigne les deux heures, ou aucune.';
  return null;
}
