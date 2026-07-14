// ── P366 — Mobile network analytics (READ-ONLY) — pure helpers ──────────────
// Pure, side-effect-free building blocks for the /mobile/v1/analytics/* API.
// All money values are integer minor units (centimes). No value is ever
// invented: when a metric cannot be computed (division by zero, missing
// baseline), the field is null and the client renders "Donnée indisponible".
// ─────────────────────────────────────────────────────────────────────────────

/** Half-open UTC window [from, to). */
export interface TimeWindow {
  from: Date;
  to: Date;
}

export interface PeriodKpis {
  /** CA net (centimes) — completed sales only. */
  revenueMinorUnits: number;
  /** Nombre de tickets (ventes complétées). */
  tickets: number;
  /** Panier moyen (centimes) — null quand 0 ticket. */
  avgTicketMinorUnits: number | null;
  /** Articles vendus (somme des quantités de lignes). */
  itemsSold: number;
  /** Remises accordées (centimes). */
  discountMinorUnits: number;
  /** Taux de remise = remises / (CA + remises) — null si base nulle. */
  discountRatePct: number | null;
  /** Avoirs / remboursements émis dans la fenêtre. */
  refunds: { count: number; amountMinorUnits: number };
  /** Ventes annulées (status voided) dans la fenêtre. */
  cancellations: number;
  /** Magasins ayant au moins une vente dans la fenêtre. */
  activeStores: number;
}

/** A raw KPI row as returned by the SQL aggregation (strings from pg). */
export interface RawKpiRow {
  revenue: string | number | null;
  tickets: string | number | null;
  discount: string | number | null;
  active_stores?: string | number | null;
}

export const num = (v: string | number | null | undefined): number => {
  if (v === null || v === undefined) return 0;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** Percentage growth vs a baseline; null when baseline is 0 (not fabricated). */
export function growthPct(current: number, previous: number): number | null {
  if (!previous) return null;
  return Math.round(((current - previous) / previous) * 10000) / 100;
}

/** Safe ratio in %, null when denominator is 0. */
export function ratioPct(part: number, whole: number): number | null {
  if (!whole) return null;
  return Math.round((part / whole) * 10000) / 100;
}

/** Same-length window immediately before [from, to). */
export function previousWindow(win: TimeWindow): TimeWindow {
  const span = win.to.getTime() - win.from.getTime();
  return { from: new Date(win.from.getTime() - span), to: new Date(win.from.getTime()) };
}

/** Same calendar window one year earlier (setFullYear −1 on both bounds). */
export function yearAgoWindow(win: TimeWindow): TimeWindow {
  const shift = (d: Date) => {
    const c = new Date(d.getTime());
    c.setUTCFullYear(c.getUTCFullYear() - 1);
    return c;
  };
  return { from: shift(win.from), to: shift(win.to) };
}

/** Parse and validate the from/to query params. Throws on malformed input. */
export function parseWindow(from?: string, to?: string): TimeWindow {
  if (!from || !to) throw new Error('from/to requis (ISO 8601)');
  const f = new Date(from);
  const t = new Date(to);
  if (Number.isNaN(f.getTime()) || Number.isNaN(t.getTime())) {
    throw new Error('from/to invalides (ISO 8601 attendu)');
  }
  if (t.getTime() <= f.getTime()) throw new Error('to doit être après from');
  // Bound: 5 years max, protects the aggregation from unbounded scans.
  if (t.getTime() - f.getTime() > 5 * 366 * 24 * 3600 * 1000) {
    throw new Error('période trop longue (max 5 ans)');
  }
  return { from: f, to: t };
}

const TZ_RE = /^[A-Za-z_]+(\/[A-Za-z_+-]+){0,2}$/;

/** Validate an IANA timezone name (whitelist shape, default Europe/Paris). */
export function safeTimezone(tz?: string): string {
  if (tz && TZ_RE.test(tz)) return tz;
  return 'Europe/Paris';
}

export function buildKpis(
  main: RawKpiRow | undefined,
  items: number,
  refunds: { count: number; amountMinorUnits: number },
  cancellations: number,
): PeriodKpis {
  const revenue = num(main?.revenue);
  const tickets = num(main?.tickets);
  const discount = num(main?.discount);
  return {
    revenueMinorUnits: revenue,
    tickets,
    avgTicketMinorUnits: tickets ? Math.round(revenue / tickets) : null,
    itemsSold: items,
    discountMinorUnits: discount,
    discountRatePct: ratioPct(discount, revenue + discount),
    refunds,
    cancellations,
    activeStores: num(main?.active_stores),
  };
}

// ── Store ranking ────────────────────────────────────────────────────────────

export interface StoreRankRowInput {
  store_id: string;
  name: string;
  city: string | null;
  revenue: string | number | null;
  tickets: string | number | null;
  discount: string | number | null;
  /** Distinct hours (in store tz) with at least one sale — proxy for CA/heure. */
  active_hours: string | number | null;
}

export interface StoreRankEntry {
  storeId: string;
  name: string;
  city: string | null;
  revenueMinorUnits: number;
  previousRevenueMinorUnits: number;
  growthPct: number | null;
  tickets: number;
  avgTicketMinorUnits: number | null;
  itemsSold: number;
  discountMinorUnits: number;
  discountRatePct: number | null;
  refundCount: number;
  refundAmountMinorUnits: number;
  refundRatePct: number | null;
  cancellations: number;
  /** CA / heure active de vente — proxy honnête (pas d'horaires d'ouverture en base). */
  revenuePerActiveHourMinorUnits: number | null;
  /** Marge brute estimée (coût actuel produit) — null si aucun coût renseigné. */
  marginMinorUnits: number | null;
  /** Part des lignes (en CA) couvertes par un coût produit connu. */
  marginCoveragePct: number | null;
  /** CA / m² — non calculable : la surface magasin n'existe pas en base. */
  revenuePerSqmMinorUnits: null;
  /** Session POS active à l'instant du calcul (instantané temps réel). */
  openNow: boolean;
  rank: number;
}

export type StoreSortKey =
  | 'revenue'
  | 'growth'
  | 'avgTicket'
  | 'tickets'
  | 'items'
  | 'revenuePerHour'
  | 'margin'
  | 'discountRate'
  | 'refundRate';

/**
 * Merge the per-store aggregation rows (current, previous, items, margin,
 * refunds, cancellations) into a sorted ranking. Missing side-tables simply
 * yield 0 / null — never invented values.
 */
export function buildStoreRanking(input: {
  current: StoreRankRowInput[];
  previous: Array<{ store_id: string; revenue: string | number | null }>;
  items: Array<{ store_id: string; qty: string | number | null }>;
  margins: Array<{
    store_id: string;
    margin: string | number | null;
    covered_revenue: string | number | null;
    total_revenue: string | number | null;
  }>;
  refunds: Array<{ store_id: string; count: string | number | null; amount: string | number | null }>;
  cancellations: Array<{ store_id: string; count: string | number | null }>;
  sort?: StoreSortKey;
}): StoreRankEntry[] {
  const prevBy = new Map(input.previous.map((r) => [r.store_id, num(r.revenue)]));
  const itemsBy = new Map(input.items.map((r) => [r.store_id, num(r.qty)]));
  const marginBy = new Map(input.margins.map((r) => [r.store_id, r]));
  const refundsBy = new Map(input.refunds.map((r) => [r.store_id, r]));
  const cancelBy = new Map(input.cancellations.map((r) => [r.store_id, num(r.count)]));

  const entries: StoreRankEntry[] = input.current.map((r) => {
    const revenue = num(r.revenue);
    const tickets = num(r.tickets);
    const discount = num(r.discount);
    const prev = prevBy.get(r.store_id) ?? 0;
    const m = marginBy.get(r.store_id);
    const coveredRevenue = num(m?.covered_revenue);
    const totalRevenue = num(m?.total_revenue);
    const ref = refundsBy.get(r.store_id);
    const refundCount = num(ref?.count);
    const activeHours = num(r.active_hours);
    return {
      storeId: r.store_id,
      name: r.name,
      city: r.city ?? null,
      revenueMinorUnits: revenue,
      previousRevenueMinorUnits: prev,
      growthPct: growthPct(revenue, prev),
      tickets,
      avgTicketMinorUnits: tickets ? Math.round(revenue / tickets) : null,
      itemsSold: itemsBy.get(r.store_id) ?? 0,
      discountMinorUnits: discount,
      discountRatePct: ratioPct(discount, revenue + discount),
      refundCount,
      refundAmountMinorUnits: num(ref?.amount),
      refundRatePct: ratioPct(refundCount, tickets),
      cancellations: cancelBy.get(r.store_id) ?? 0,
      revenuePerActiveHourMinorUnits: activeHours ? Math.round(revenue / activeHours) : null,
      marginMinorUnits: m && coveredRevenue > 0 ? num(m.margin) : null,
      marginCoveragePct: totalRevenue > 0 ? ratioPct(coveredRevenue, totalRevenue) : null,
      revenuePerSqmMinorUnits: null,
      openNow: false,
      rank: 0,
    };
  });

  const key = input.sort ?? 'revenue';
  const val = (e: StoreRankEntry): number => {
    switch (key) {
      case 'growth':
        return e.growthPct ?? -Infinity;
      case 'avgTicket':
        return e.avgTicketMinorUnits ?? -Infinity;
      case 'tickets':
        return e.tickets;
      case 'items':
        return e.itemsSold;
      case 'revenuePerHour':
        return e.revenuePerActiveHourMinorUnits ?? -Infinity;
      case 'margin':
        return e.marginMinorUnits ?? -Infinity;
      case 'discountRate':
        return e.discountRatePct ?? -Infinity;
      case 'refundRate':
        return e.refundRatePct ?? -Infinity;
      default:
        return e.revenueMinorUnits;
    }
  };
  // Deterministic: metric desc, then name asc.
  entries.sort((a, b) => val(b) - val(a) || a.name.localeCompare(b.name));
  entries.forEach((e, i) => (e.rank = i + 1));
  return entries;
}

// ── Comparison ───────────────────────────────────────────────────────────────

export interface CompareSide {
  label: string;
  window: { from: string; to: string };
  storeId: string | null;
  kpis: PeriodKpis;
  dailySeries: Array<{ date: string; revenueMinorUnits: number; tickets: number }>;
  hourly: Array<{ hour: number; revenueMinorUnits: number; tickets: number }>;
}

export interface CompareDelta {
  revenueDeltaMinorUnits: number;
  revenueDeltaPct: number | null;
  ticketsDelta: number;
  ticketsDeltaPct: number | null;
  avgTicketDeltaMinorUnits: number | null;
  itemsDelta: number;
  discountRateDeltaPts: number | null;
  refundCountDelta: number;
}

/** A − B deltas; pct is relative to B (the reference side). */
export function buildCompareDelta(a: PeriodKpis, b: PeriodKpis): CompareDelta {
  return {
    revenueDeltaMinorUnits: a.revenueMinorUnits - b.revenueMinorUnits,
    revenueDeltaPct: growthPct(a.revenueMinorUnits, b.revenueMinorUnits),
    ticketsDelta: a.tickets - b.tickets,
    ticketsDeltaPct: growthPct(a.tickets, b.tickets),
    avgTicketDeltaMinorUnits:
      a.avgTicketMinorUnits !== null && b.avgTicketMinorUnits !== null
        ? a.avgTicketMinorUnits - b.avgTicketMinorUnits
        : null,
    itemsDelta: a.itemsSold - b.itemsSold,
    discountRateDeltaPts:
      a.discountRatePct !== null && b.discountRatePct !== null
        ? Math.round((a.discountRatePct - b.discountRatePct) * 100) / 100
        : null,
    refundCountDelta: a.refunds.count - b.refunds.count,
  };
}

// ── Categories ───────────────────────────────────────────────────────────────

export interface CategoryEntry {
  category: string;
  revenueMinorUnits: number;
  quantity: number;
  sharePct: number | null;
  previousRevenueMinorUnits: number;
  growthPct: number | null;
  topStore: { storeId: string; name: string; revenueMinorUnits: number } | null;
  topProducts: Array<{ ean: string; name: string; quantity: number }>;
}

export function buildCategories(input: {
  current: Array<{ category: string | null; revenue: string | number | null; qty: string | number | null }>;
  previous: Array<{ category: string | null; revenue: string | number | null }>;
  topStores: Array<{
    category: string | null;
    store_id: string;
    store_name: string;
    revenue: string | number | null;
    rn: string | number;
  }>;
  topProducts: Array<{
    category: string | null;
    ean: string;
    name: string;
    qty: string | number | null;
    rn: string | number;
  }>;
}): CategoryEntry[] {
  const label = (c: string | null) => c ?? 'Sans catégorie';
  const prevBy = new Map(input.previous.map((r) => [label(r.category), num(r.revenue)]));
  const total = input.current.reduce((s, r) => s + num(r.revenue), 0);

  const topStoreBy = new Map<string, { storeId: string; name: string; revenueMinorUnits: number }>();
  for (const r of input.topStores) {
    if (num(r.rn) === 1) {
      topStoreBy.set(label(r.category), {
        storeId: r.store_id,
        name: r.store_name,
        revenueMinorUnits: num(r.revenue),
      });
    }
  }
  const topProdBy = new Map<string, Array<{ ean: string; name: string; quantity: number }>>();
  for (const r of input.topProducts) {
    const k = label(r.category);
    const list = topProdBy.get(k) ?? [];
    if (list.length < 3) list.push({ ean: r.ean, name: r.name, quantity: num(r.qty) });
    topProdBy.set(k, list);
  }

  return input.current
    .map((r) => {
      const k = label(r.category);
      const revenue = num(r.revenue);
      const prev = prevBy.get(k) ?? 0;
      return {
        category: k,
        revenueMinorUnits: revenue,
        quantity: num(r.qty),
        sharePct: ratioPct(revenue, total),
        previousRevenueMinorUnits: prev,
        growthPct: growthPct(revenue, prev),
        topStore: topStoreBy.get(k) ?? null,
        topProducts: topProdBy.get(k) ?? [],
      };
    })
    .sort((a, b) => b.revenueMinorUnits - a.revenueMinorUnits || a.category.localeCompare(b.category));
}

// ── Séries multi-magasins (P367) ─────────────────────────────────────────────

export type SeriesBucket = 'hour' | 'day' | 'week' | 'month';

export const MAX_SERIES_POINTS = 400;
export const MAX_SERIES_STORES = 30;

const BUCKET_MS: Record<SeriesBucket, number> = {
  hour: 3600_000,
  day: 86_400_000,
  week: 7 * 86_400_000,
  month: 30 * 86_400_000,
};

/**
 * Choix automatique du regroupement selon la durée : ≤ 2 j → heure,
 * ≤ 62 j → jour, ≤ 200 j → semaine, sinon mois. Un bucket explicite est
 * accepté s'il reste sous MAX_SERIES_POINTS (borne anti-scan).
 */
export function resolveBucket(win: TimeWindow, requested?: string): SeriesBucket {
  const span = win.to.getTime() - win.from.getTime();
  if (requested && requested !== 'auto') {
    if (!['hour', 'day', 'week', 'month'].includes(requested)) {
      throw new Error(`bucket invalide : ${requested}`);
    }
    const b = requested as SeriesBucket;
    if (span / BUCKET_MS[b] > MAX_SERIES_POINTS) {
      throw new Error(`trop de points pour bucket=${b} sur cette période (max ${MAX_SERIES_POINTS})`);
    }
    return b;
  }
  if (span <= 2 * BUCKET_MS.day) return 'hour';
  if (span <= 62 * BUCKET_MS.day) return 'day';
  if (span <= 200 * BUCKET_MS.day) return 'week';
  return 'month';
}

/** Composantes brutes d'un point de série (centimes / compteurs entiers). */
export interface SeriesPointComponents {
  t: string; // clé de bucket locale « YYYY-MM-DD HH24:MI »
  revenue: number;
  tickets: number;
  items: number;
  discount: number;
  refunds: number;
  cancellations: number;
  /** Marge estimée (coût produit actuel) — null si aucun coût couvert. */
  margin: number | null;
}

/**
 * Zéro-remplissage honnête : chaque clé du domaine existe, ventes absentes = 0
 * réel (« aucune vente »), jamais d'interpolation entre deux points distants.
 */
export function fillSeries(
  domain: string[],
  rows: Map<string, Partial<SeriesPointComponents>>,
): SeriesPointComponents[] {
  return domain.map((t) => {
    const r = rows.get(t);
    return {
      t,
      revenue: num(r?.revenue as any),
      tickets: num(r?.tickets as any),
      items: num(r?.items as any),
      discount: num(r?.discount as any),
      refunds: num(r?.refunds as any),
      cancellations: num(r?.cancellations as any),
      margin: r?.margin === null || r?.margin === undefined ? null : num(r.margin as any),
    };
  });
}
