// ── Séries multi-magasins (pur, testé) ───────────────────────────
// Dérivation d'indicateurs à partir des composantes brutes renvoyées
// par /analytics/series (le changement d'indicateur ne redéclenche
// AUCUN appel réseau), labels de buckets, classement au créneau
// sélectionné, conclusions factuelles (jamais causales).
// ─────────────────────────────────────────────────────────────────

export interface SeriesPoint {
  t: string; // « YYYY-MM-DD HH:MM » (heure locale du fuseau demandé)
  revenue: number;
  tickets: number;
  items: number;
  discount: number;
  refunds: number;
  cancellations: number;
  margin: number | null;
}

export interface StoreSeries {
  storeId: string;
  name: string;
  points: SeriesPoint[];
}

export type MetricKey =
  | 'revenue'
  | 'tickets'
  | 'avgTicket'
  | 'items'
  | 'itemsPerTicket'
  | 'discount'
  | 'refunds'
  | 'cancellations'
  | 'margin';

export const METRICS: Array<{ key: MetricKey; label: string; kind: 'money' | 'count' | 'ratio' }> = [
  { key: 'revenue', label: "Chiffre d'affaires", kind: 'money' },
  { key: 'tickets', label: 'Tickets', kind: 'count' },
  { key: 'avgTicket', label: 'Panier moyen', kind: 'money' },
  { key: 'items', label: 'Articles vendus', kind: 'count' },
  { key: 'itemsPerTicket', label: 'Articles / ticket', kind: 'ratio' },
  { key: 'discount', label: 'Remises', kind: 'money' },
  { key: 'refunds', label: 'Remboursements', kind: 'count' },
  { key: 'cancellations', label: 'Annulations', kind: 'count' },
  { key: 'margin', label: 'Marge estimée', kind: 'money' },
];

/**
 * Valeur d'un indicateur pour un point. null = non calculable (0 ticket pour
 * un panier moyen, coût produit absent pour la marge) — jamais un 0 inventé.
 */
export function metricValue(p: SeriesPoint, metric: MetricKey): number | null {
  switch (metric) {
    case 'revenue':
      return p.revenue;
    case 'tickets':
      return p.tickets;
    case 'avgTicket':
      return p.tickets ? Math.round(p.revenue / p.tickets) : null;
    case 'items':
      return p.items;
    case 'itemsPerTicket':
      return p.tickets ? Math.round((p.items / p.tickets) * 100) / 100 : null;
    case 'discount':
      return p.discount;
    case 'refunds':
      return p.refunds;
    case 'cancellations':
      return p.cancellations;
    case 'margin':
      return p.margin;
  }
}

/** Agrégat d'une série sur toute la période. */
export function aggregate(points: SeriesPoint[]): SeriesPoint {
  const sum = points.reduce(
    (acc, p) => ({
      t: '',
      revenue: acc.revenue + p.revenue,
      tickets: acc.tickets + p.tickets,
      items: acc.items + p.items,
      discount: acc.discount + p.discount,
      refunds: acc.refunds + p.refunds,
      cancellations: acc.cancellations + p.cancellations,
      margin:
        p.margin === null ? acc.margin : (acc.margin ?? 0) + p.margin,
    }),
    { t: '', revenue: 0, tickets: 0, items: 0, discount: 0, refunds: 0, cancellations: 0, margin: null as number | null },
  );
  return sum;
}

const MONTHS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];

/** Label d'axe : « 14 h », « 1 juil. », « sem. 6 juil. », « juil. 2026 ». */
export function bucketLabel(t: string, bucket: string): string {
  // t = « YYYY-MM-DD HH:MM »
  const [date, time] = t.split(' ');
  const [y, m, d] = date.split('-').map(Number);
  switch (bucket) {
    case 'hour':
      return `${Number(time.split(':')[0])} h`;
    case 'day':
      return `${d} ${MONTHS[m - 1]}`;
    case 'week':
      return `sem. ${d} ${MONTHS[m - 1]}`;
    default:
      return `${MONTHS[m - 1]} ${y}`;
  }
}

/** Label long pour l'infobulle : « 14 h – 15 h » ou « mar. 14 juil. ». */
export function bucketTooltipLabel(t: string, bucket: string): string {
  const [date, time] = t.split(' ');
  const [y, m, d] = date.split('-').map(Number);
  if (bucket === 'hour') {
    const h = Number(time.split(':')[0]);
    return `${h} h – ${h + 1} h`;
  }
  if (bucket === 'day') {
    const dow = ['dim.', 'lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.'][new Date(y, m - 1, d).getDay()];
    return `${dow} ${d} ${MONTHS[m - 1]}`;
  }
  return bucketLabel(t, bucket);
}

export interface RankedAt {
  storeId: string;
  name: string;
  value: number | null;
  point: SeriesPoint;
}

/** Classement des magasins au créneau sélectionné (desc, null en dernier). */
export function rankAt(series: StoreSeries[], idx: number, metric: MetricKey): RankedAt[] {
  return series
    .map((s) => ({
      storeId: s.storeId,
      name: s.name,
      value: s.points[idx] ? metricValue(s.points[idx], metric) : null,
      point: s.points[idx],
    }))
    .sort((a, b) => (b.value ?? -Infinity) - (a.value ?? -Infinity) || a.name.localeCompare(b.name));
}

/** Classement des magasins sur toute la période. */
export function rankPeriod(series: StoreSeries[], metric: MetricKey): RankedAt[] {
  return series
    .map((s) => {
      const agg = aggregate(s.points);
      return { storeId: s.storeId, name: s.name, value: metricValue(agg, metric), point: agg };
    })
    .sort((a, b) => (b.value ?? -Infinity) - (a.value ?? -Infinity) || a.name.localeCompare(b.name));
}

// ── Conclusions factuelles ───────────────────────────────────────
// Uniquement ce que montrent les chiffres — jamais d'explication
// causale, jamais de valeur inventée.

const pct = (a: number, b: number): number | null =>
  b ? Math.round(((a - b) / b) * 1000) / 10 : null;

const fmtEur = (minor: number) =>
  new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: minor % 100 === 0 ? 0 : 2 }).format(minor / 100);

export function buildConclusions(series: StoreSeries[], bucket: string): string[] {
  const out: string[] = [];
  if (!series.length) return out;
  const ranked = rankPeriod(series, 'revenue');
  const withSales = ranked.filter((r) => (r.value ?? 0) > 0);
  if (!withSales.length) {
    out.push('Aucune vente enregistrée sur la période pour la sélection.');
    return out;
  }

  if (series.length >= 2) {
    const [first, second] = ranked;
    const p = pct(first.value ?? 0, second.value ?? 0);
    if (p !== null && p > 0) {
      out.push(
        `${first.name} réalise ${p.toLocaleString('fr-FR')} % de chiffre d'affaires de plus que ${second.name} (${fmtEur(first.value ?? 0)} contre ${fmtEur(second.value ?? 0)}).`,
      );
    } else if ((first.value ?? 0) === (second.value ?? 0)) {
      out.push(`${first.name} et ${second.name} réalisent le même chiffre d'affaires (${fmtEur(first.value ?? 0)}).`);
    }

    // Tickets vs panier : un magasin peut faire plus de tickets avec un panier plus faible.
    const byTickets = rankPeriod(series, 'tickets');
    const topTickets = byTickets[0];
    if (topTickets.storeId !== first.storeId && (topTickets.value ?? 0) > 0) {
      const aggTop = topTickets.point;
      const aggFirst = first.point;
      const basketTop = aggTop.tickets ? aggTop.revenue / aggTop.tickets : null;
      const basketFirst = aggFirst.tickets ? aggFirst.revenue / aggFirst.tickets : null;
      if (basketTop !== null && basketFirst !== null && basketTop < basketFirst) {
        out.push(`${topTickets.name} génère davantage de tickets, mais son panier moyen est inférieur.`);
      }
    }

    // Principal écart temporel entre le 1er et le 2e (uniquement descriptif).
    const a = series.find((s) => s.storeId === first.storeId)!;
    const b = series.find((s) => s.storeId === second.storeId)!;
    let bestIdx = -1;
    let bestGap = 0;
    a.points.forEach((p1, i) => {
      const gap = Math.abs(p1.revenue - (b.points[i]?.revenue ?? 0));
      if (gap > bestGap) {
        bestGap = gap;
        bestIdx = i;
      }
    });
    if (bestIdx >= 0 && bestGap > 0) {
      out.push(
        `Le principal écart se situe ${bucket === 'hour' ? 'entre ' + bucketTooltipLabel(a.points[bestIdx].t, bucket) : 'le ' + bucketTooltipLabel(a.points[bestIdx].t, bucket)} (${fmtEur(bestGap)} d'écart).`,
      );
    }
  }

  // Dernier de la sélection (uniquement si ≥ 3 magasins pour être utile).
  if (series.length >= 3) {
    const last = ranked[ranked.length - 1];
    out.push(`${last.name} est le moins performant de la sélection sur la période (${fmtEur(last.value ?? 0)}).`);
  }
  return out;
}

/** Modes d'affichage quand il y a beaucoup de courbes. */
export type ChartMode = 'all' | 'top5' | 'bottom5' | 'avg' | 'small';

export function applyChartMode(series: StoreSeries[], mode: ChartMode): StoreSeries[] {
  if (mode === 'top5' || mode === 'bottom5') {
    const ranked = rankPeriod(series, 'revenue');
    const ids = (mode === 'top5' ? ranked.slice(0, 5) : ranked.slice(-5)).map((r) => r.storeId);
    return series.filter((s) => ids.includes(s.storeId));
  }
  return series;
}
