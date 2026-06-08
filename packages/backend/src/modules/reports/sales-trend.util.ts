/**
 * Tendances CA — cœur PUR (aucune I/O, aucun recalcul fiscal).
 *
 * Consomme une série de CA quotidien DÉJÀ FIGÉ (somme des ventes complétées par
 * jour) et produit :
 *  - des comparaisons J-1 / S-1 / M-1 / N-1 (avec variation %) ;
 *  - une prévision SIMPLE du CA du jour suivant (moyenne même-jour-de-semaine,
 *    repli moyenne mobile 7j).
 *
 * Ce n'est PAS de l'IA : extrapolation simple, déterministe, étiquetée comme
 * telle (méthode + taille d'échantillon exposées).
 */

/** Map clé 'YYYY-MM-DD' → CA en unités mineures (centimes). */
export type DailyCaMap = Record<string, number>;

export interface BaselineComparison {
  date: string;
  caMinorUnits: number;
  deltaPct: number | null; // variation du jour de référence VS ce baseline
}
export interface TrendComparisons {
  today: { date: string; caMinorUnits: number };
  jMinus1: BaselineComparison; // hier
  sMinus1: BaselineComparison; // même jour S-1
  mMinus1: BaselineComparison; // même quantième M-1
  nMinus1: BaselineComparison; // même date N-1
}

export interface CaForecast {
  date: string;
  predictedMinorUnits: number;
  method: 'weekday-average' | 'moving-average-7' | 'insufficient-data';
  sampleSize: number;
}

/* ── Helpers de date (sur clés 'YYYY-MM-DD', déterministes) ──────────────── */
export function dateKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Clé de JOUR COMMERCIAL dans le fuseau du magasin (pas UTC).
 *
 * Indispensable pour que les comparaisons J-1/S-1… et la prévision tombent sur
 * la BONNE journée locale et restent cohérentes avec le Z-report (qui raisonne
 * en date locale). Ex. une vente à 01:00 Europe/Paris (23:00 UTC la veille)
 * doit compter sur le jour local, pas le jour UTC précédent.
 */
export function localDateKey(instant: string | Date, timeZone = 'Europe/Paris'): string {
  const d = instant instanceof Date ? instant : new Date(instant);
  // en-CA → 'YYYY-MM-DD'
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}
function parseKey(key: string): Date {
  return new Date(`${key}T00:00:00.000Z`);
}
function addDays(key: string, n: number): string {
  const d = parseKey(key);
  d.setUTCDate(d.getUTCDate() + n);
  return dateKey(d);
}
function addMonths(key: string, n: number): string {
  const d = parseKey(key);
  d.setUTCMonth(d.getUTCMonth() + n);
  return dateKey(d);
}
function addYears(key: string, n: number): string {
  const d = parseKey(key);
  d.setUTCFullYear(d.getUTCFullYear() + n);
  return dateKey(d);
}

function deltaPct(current: number, base: number): number | null {
  if (base <= 0) return current > 0 ? 100 : null;
  return Math.round(((current - base) / base) * 100);
}

/** Comparaisons du jour `todayKey` vs J-1 / S-1 / M-1 / N-1. */
export function compareBaselines(map: DailyCaMap, todayKey: string): TrendComparisons {
  const ca = (k: string) => map[k] ?? 0;
  const today = ca(todayKey);
  const mk = (key: string): BaselineComparison => ({
    date: key,
    caMinorUnits: ca(key),
    deltaPct: deltaPct(today, ca(key)),
  });
  return {
    today: { date: todayKey, caMinorUnits: today },
    jMinus1: mk(addDays(todayKey, -1)),
    sMinus1: mk(addDays(todayKey, -7)),
    mMinus1: mk(addMonths(todayKey, -1)),
    nMinus1: mk(addYears(todayKey, -1)),
  };
}

/** Prévision simple du CA pour `targetKey` (lendemain du dernier jour connu). */
export function forecastNextDay(map: DailyCaMap, lastKnownKey: string): CaForecast {
  const targetKey = addDays(lastKnownKey, 1);

  // 1) Moyenne des 4 mêmes jours de semaine précédents (J-7, J-14, J-21, J-28).
  const sameWeekday: number[] = [];
  for (let w = 1; w <= 4; w++) {
    const k = addDays(targetKey, -7 * w);
    if (k in map) sameWeekday.push(map[k]);
  }
  if (sameWeekday.length >= 2) {
    const avg = sameWeekday.reduce((s, v) => s + v, 0) / sameWeekday.length;
    return { date: targetKey, predictedMinorUnits: Math.round(avg), method: 'weekday-average', sampleSize: sameWeekday.length };
  }

  // 2) Repli : moyenne mobile des 7 derniers jours connus (jusqu'à lastKnownKey).
  const last7: number[] = [];
  for (let i = 0; i < 7; i++) {
    const k = addDays(lastKnownKey, -i);
    if (k in map) last7.push(map[k]);
  }
  if (last7.length >= 1) {
    const avg = last7.reduce((s, v) => s + v, 0) / last7.length;
    return { date: targetKey, predictedMinorUnits: Math.round(avg), method: 'moving-average-7', sampleSize: last7.length };
  }

  return { date: targetKey, predictedMinorUnits: 0, method: 'insufficient-data', sampleSize: 0 };
}
