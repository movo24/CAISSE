// ── Formats d'affichage (pur, testé) ─────────────────────────────
// Tout montant venu de l'API est un ENTIER en centimes (règle projet).
// Quand une valeur est absente (null/undefined), on affiche
// « Donnée indisponible » (ou « — » en contexte court) — jamais un 0
// fabriqué ni une valeur inventée.
// ─────────────────────────────────────────────────────────────────

export const UNAVAILABLE = 'Donnée indisponible';

/** 123456 centimes → « 1 234,56 € » (devise adaptée au magasin). */
export function formatMoney(
  minorUnits: number | null | undefined,
  currency = 'EUR',
  locale = 'fr-FR',
): string {
  if (minorUnits === null || minorUnits === undefined || !Number.isFinite(minorUnits)) {
    return UNAVAILABLE;
  }
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
  }).format(minorUnits / 100);
}

/** Version compacte pour les grands chiffres (« 12,4 k€ »). */
export function formatMoneyCompact(
  minorUnits: number | null | undefined,
  currency = 'EUR',
  locale = 'fr-FR',
): string {
  if (minorUnits === null || minorUnits === undefined || !Number.isFinite(minorUnits)) {
    return UNAVAILABLE;
  }
  const abs = Math.abs(minorUnits);
  if (abs < 10_000_00) return formatMoney(minorUnits, currency, locale);
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(minorUnits / 100);
}

export function formatInt(n: number | null | undefined, locale = 'fr-FR'): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return UNAVAILABLE;
  return new Intl.NumberFormat(locale).format(n);
}

/** +12,5 % / −3,2 % ; null → « — » (pas de baseline, pas de % inventé). */
export function formatPct(pct: number | null | undefined): string {
  if (pct === null || pct === undefined || !Number.isFinite(pct)) return '—';
  const sign = pct > 0 ? '+' : '';
  return `${sign}${pct.toLocaleString('fr-FR', { maximumFractionDigits: 1 })} %`;
}

export type Trend = 'up' | 'down' | 'flat' | 'none';

export function trendOf(pct: number | null | undefined): Trend {
  if (pct === null || pct === undefined || !Number.isFinite(pct)) return 'none';
  if (pct > 0.05) return 'up';
  if (pct < -0.05) return 'down';
  return 'flat';
}

/** « il y a 2 min » — horodatage de dernière synchro. */
export function formatSince(iso: string | null, now: Date = new Date()): string {
  if (!iso) return 'jamais';
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return 'jamais';
  const sec = Math.max(0, Math.round((now.getTime() - t) / 1000));
  if (sec < 60) return "à l'instant";
  const min = Math.round(sec / 60);
  if (min < 60) return `il y a ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `il y a ${h} h`;
  return new Date(iso).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
}

export function formatHour(h: number | null | undefined): string {
  if (h === null || h === undefined || !Number.isFinite(h)) return UNAVAILABLE;
  return `${h} h`;
}

export const ISO_DOW_LABELS = ['', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];
