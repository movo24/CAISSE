/**
 * Analyse produit — cœur PUR (aucune I/O, aucun recalcul fiscal).
 *
 * Transforme des agrégats de ventes DÉJÀ FIGÉES (unités vendues 7j/30j/30-60j,
 * dernière vente) + l'état stock en signaux d'aide à la décision :
 *  - vélocité de vente, jours avant rupture, quantité de réassort suggérée ;
 *  - classification star / steady / slow / dormant / no-sales ;
 *  - tendance (30j vs 30-60j) et détection de déclin.
 *
 * Ce n'est PAS de l'« IA » : c'est du calcul simple, déterministe et testable.
 * Étage 1-2 du modèle (données fiables → détection), pas étage 4.
 */

export interface ProductSalesRow {
  productId: string;
  name: string;
  ean?: string | null;
  stockQuantity: number;
  priceMinorUnits: number;
  /** Coût d'achat unitaire (centimes) — null si inconnu → marge non calculable. */
  costMinorUnits?: number | null;
  isActive: boolean;
  unitsSold7d: number;
  unitsSold30d: number;
  /** CA des 30 derniers jours (somme des totaux de lignes figés, centimes). */
  revenue30dMinorUnits?: number;
  /** Unités vendues entre J-60 et J-30 (fenêtre précédente, pour la tendance). */
  unitsSoldPrev30d?: number;
  /** Dernière vente (ISO) ou null si jamais vendu. */
  lastSoldAt?: string | null;
}

export type Classification = 'star' | 'steady' | 'slow' | 'dormant' | 'no-sales';

export interface ProductAnalytics {
  productId: string;
  name: string;
  ean?: string | null;
  stockQuantity: number;
  valeurStockMinorUnits: number;
  unitsSold7d: number;
  unitsSold30d: number;
  /** CA 30j (centimes) et marge brute % (null si coût inconnu). */
  revenue30dMinorUnits: number;
  marginPct: number | null;
  /** Unités/jour sur 30 jours. */
  dailyVelocity: number;
  lastSoldAt: string | null;
  daysSinceLastSale: number | null;
  /** Jours estimés avant rupture au rythme actuel (null si pas de ventes). */
  daysUntilStockout: number | null;
  /** Quantité conseillée à recommander pour couvrir lead + couverture. */
  suggestedReorderQty: number;
  /** Variation 30j vs 30-60j en % (null si pas de base). */
  trendPct: number | null;
  classification: Classification;
  needsReorder: boolean;
  declining: boolean;
}

export interface AnalyticsOptions {
  /** Date de référence (ISO) — injectée pour un calcul déterministe. */
  now: string;
  /** Sans vente depuis ce nb de jours (et stock > 0) → dormant. Défaut 30. */
  dormantDays?: number;
  /** Délai fournisseur (jours). Défaut 7. */
  leadDays?: number;
  /** Couverture cible après réassort (jours). Défaut 14. */
  coverDays?: number;
  /** Rupture sous ce nb de jours → à recommander. Défaut 7. */
  reorderThresholdDays?: number;
}

export interface ProductAnalyticsReport {
  items: ProductAnalytics[];
  top: ProductAnalytics[];
  flop: ProductAnalytics[];
  dormant: ProductAnalytics[];
  reorder: ProductAnalytics[];
  generatedAt: string;
}

function daysBetween(fromIso: string, toIso: string): number {
  const ms = new Date(toIso).getTime() - new Date(fromIso).getTime();
  return Math.floor(ms / 86_400_000);
}

/** Analyse un produit (pur). */
export function analyzeProduct(row: ProductSalesRow, opts: AnalyticsOptions): ProductAnalytics {
  const dormantDays = opts.dormantDays ?? 30;
  const leadDays = opts.leadDays ?? 7;
  const coverDays = opts.coverDays ?? 14;
  const reorderThresholdDays = opts.reorderThresholdDays ?? 7;

  const dailyVelocity = row.unitsSold30d / 30;
  // Pour la rupture : on prend le rythme le plus rapide (30j vs 7j) afin de
  // capter une accélération récente et ne pas sous-estimer une rupture.
  const velocity7 = row.unitsSold7d / 7;
  const effectiveVelocity = Math.max(dailyVelocity, velocity7);
  const daysSinceLastSale = row.lastSoldAt ? Math.max(0, daysBetween(row.lastSoldAt, opts.now)) : null;

  const revenue30dMinorUnits = row.revenue30dMinorUnits ?? 0;
  let marginPct: number | null = null;
  if (row.costMinorUnits != null && row.costMinorUnits > 0 && revenue30dMinorUnits > 0) {
    const cogs = row.costMinorUnits * row.unitsSold30d;
    marginPct = Math.round(((revenue30dMinorUnits - cogs) / revenue30dMinorUnits) * 100);
  }

  const prev = row.unitsSoldPrev30d;
  let trendPct: number | null = null;
  if (prev !== undefined) {
    if (prev > 0) trendPct = Math.round(((row.unitsSold30d - prev) / prev) * 100);
    else if (row.unitsSold30d > 0) trendPct = 100;
    else trendPct = 0;
  }

  const daysUntilStockout = effectiveVelocity > 0 ? Math.floor(row.stockQuantity / effectiveVelocity) : null;
  const needsReorder = daysUntilStockout !== null && daysUntilStockout <= reorderThresholdDays;
  const suggestedReorderQty = needsReorder
    ? Math.max(0, Math.ceil(effectiveVelocity * (leadDays + coverDays)) - row.stockQuantity)
    : 0;

  const declining = (trendPct !== null && trendPct <= -40) && row.unitsSold30d > 0;

  let classification: Classification;
  if (row.unitsSold30d === 0) {
    classification = row.stockQuantity > 0 ? 'dormant' : 'no-sales';
  } else if (daysSinceLastSale !== null && daysSinceLastSale > dormantDays) {
    classification = 'dormant';
  } else if (dailyVelocity >= 0.5 && (trendPct === null || trendPct >= 0)) {
    classification = 'star';
  } else if (dailyVelocity < 0.1) {
    classification = 'slow';
  } else {
    classification = 'steady';
  }

  return {
    productId: row.productId,
    name: row.name,
    ean: row.ean ?? null,
    stockQuantity: row.stockQuantity,
    valeurStockMinorUnits: row.stockQuantity * row.priceMinorUnits,
    unitsSold7d: row.unitsSold7d,
    unitsSold30d: row.unitsSold30d,
    revenue30dMinorUnits,
    marginPct,
    dailyVelocity: Math.round(dailyVelocity * 100) / 100,
    lastSoldAt: row.lastSoldAt ?? null,
    daysSinceLastSale,
    daysUntilStockout,
    suggestedReorderQty,
    trendPct,
    classification,
    needsReorder,
    declining,
  };
}

/** Construit le rapport complet (top / flop / dormant / réassort). */
export function computeProductAnalytics(
  rows: ProductSalesRow[],
  opts: AnalyticsOptions,
): ProductAnalyticsReport {
  const items = rows.filter((r) => r.isActive).map((r) => analyzeProduct(r, opts));

  const top = [...items]
    .filter((i) => i.unitsSold30d > 0)
    .sort((a, b) => b.unitsSold30d - a.unitsSold30d)
    .slice(0, 10);

  // Flop : a vendu mais ralentit (déclin ≥ 15%) ou rotation faible — hors dormants.
  const flop = [...items]
    .filter((i) => i.unitsSold30d > 0 && (i.classification === 'slow' || (i.trendPct !== null && i.trendPct <= -15)))
    .sort((a, b) => (a.trendPct ?? 0) - (b.trendPct ?? 0) || a.dailyVelocity - b.dailyVelocity)
    .slice(0, 10);

  const dormant = [...items]
    .filter((i) => i.classification === 'dormant')
    .sort((a, b) => (b.daysSinceLastSale ?? 9999) - (a.daysSinceLastSale ?? 9999))
    .slice(0, 20);

  const reorder = [...items]
    .filter((i) => i.needsReorder)
    .sort((a, b) => (a.daysUntilStockout ?? 9999) - (b.daysUntilStockout ?? 9999));

  return { items, top, flop, dormant, reorder, generatedAt: opts.now };
}
