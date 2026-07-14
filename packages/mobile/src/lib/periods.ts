// ── Périodes d'analyse (pur, testé) ──────────────────────────────
// Calcule des fenêtres semi-ouvertes [from, to) en heure LOCALE de
// l'appareil (le backend re-bucketise dans le fuseau demandé).
// Aucune donnée inventée : une période est toujours dérivée de `now`.
// ─────────────────────────────────────────────────────────────────

export type PeriodKey =
  | 'today'
  | 'yesterday'
  | 'this_week'
  | 'last_week'
  | 'this_month'
  | 'last_month'
  | 'last_3_months'
  | 'last_6_months'
  | 'this_semester'
  | 'last_semester'
  | 'this_year'
  | 'last_year'
  | 'custom';

export interface PeriodWindow {
  from: Date;
  to: Date;
}

export const PERIOD_LABELS: Record<PeriodKey, string> = {
  today: "Aujourd'hui",
  yesterday: 'Hier',
  this_week: 'Cette semaine',
  last_week: 'Semaine précédente',
  this_month: 'Ce mois',
  last_month: 'Mois précédent',
  last_3_months: '3 derniers mois',
  last_6_months: '6 derniers mois',
  this_semester: 'Ce semestre',
  last_semester: 'Semestre précédent',
  this_year: 'Cette année',
  last_year: 'Année précédente',
  custom: 'Personnalisée',
};

export const PERIOD_ORDER: PeriodKey[] = [
  'today', 'yesterday', 'this_week', 'last_week', 'this_month', 'last_month',
  'last_3_months', 'last_6_months', 'this_semester', 'last_semester',
  'this_year', 'last_year', 'custom',
];

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const addDays = (d: Date, n: number) =>
  new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

/** Lundi de la semaine de d (ISO). */
function startOfWeek(d: Date): Date {
  const sod = startOfDay(d);
  const dow = (sod.getDay() + 6) % 7; // lundi = 0
  return addDays(sod, -dow);
}

const startOfMonth = (d: Date) => new Date(d.getFullYear(), d.getMonth(), 1);
const startOfYear = (d: Date) => new Date(d.getFullYear(), 0, 1);
const startOfSemester = (d: Date) =>
  new Date(d.getFullYear(), d.getMonth() < 6 ? 0 : 6, 1);

/**
 * Fenêtre [from, to) pour une période. `to` est exclusif : pour les périodes
 * « en cours », to = maintenant tronqué au lendemain 00:00 (pas de futur).
 */
export function periodWindow(key: PeriodKey, now: Date, custom?: PeriodWindow): PeriodWindow {
  const tomorrow = addDays(startOfDay(now), 1);
  switch (key) {
    case 'today':
      return { from: startOfDay(now), to: tomorrow };
    case 'yesterday':
      return { from: addDays(startOfDay(now), -1), to: startOfDay(now) };
    case 'this_week':
      return { from: startOfWeek(now), to: tomorrow };
    case 'last_week': {
      const start = addDays(startOfWeek(now), -7);
      return { from: start, to: addDays(start, 7) };
    }
    case 'this_month':
      return { from: startOfMonth(now), to: tomorrow };
    case 'last_month': {
      const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      return { from: start, to: startOfMonth(now) };
    }
    case 'last_3_months':
      return { from: new Date(now.getFullYear(), now.getMonth() - 3, now.getDate()), to: tomorrow };
    case 'last_6_months':
      return { from: new Date(now.getFullYear(), now.getMonth() - 6, now.getDate()), to: tomorrow };
    case 'this_semester':
      return { from: startOfSemester(now), to: tomorrow };
    case 'last_semester': {
      const cur = startOfSemester(now);
      const prev = new Date(cur.getFullYear(), cur.getMonth() - 6, 1);
      return { from: prev, to: cur };
    }
    case 'this_year':
      return { from: startOfYear(now), to: tomorrow };
    case 'last_year':
      return { from: new Date(now.getFullYear() - 1, 0, 1), to: startOfYear(now) };
    case 'custom': {
      if (!custom) throw new Error('Période personnalisée sans bornes');
      // to inclusif côté UI (date de fin choisie) → exclusif backend (+1 jour)
      return { from: startOfDay(custom.from), to: addDays(startOfDay(custom.to), 1) };
    }
  }
}

/** Sérialise pour l'API (from/to ISO + fuseau de l'appareil). */
export function periodParams(win: PeriodWindow): { from: string; to: string; tz: string } {
  return {
    from: win.from.toISOString(),
    to: win.to.toISOString(),
    tz: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Paris',
  };
}
