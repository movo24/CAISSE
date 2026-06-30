/**
 * POS-INT-151 — inventory variance (écart d'inventaire), pure & unit-testable.
 *
 * Compares the SYSTEM stock quantity with a PHYSICAL counted quantity per product
 * and values the gap at unit cost (fallback: 0 when unknown). No DB, no side
 * effects: the caller supplies the rows (from a count) and persists nothing —
 * read-only decision support for a manager. Money is integer centimes.
 *
 * Sign convention: qtyDiff = counted − system.
 *   qtyDiff > 0  → surplus (overage)   ; valueDiff > 0
 *   qtyDiff < 0  → manquant (shortage) ; valueDiff < 0
 */

export interface VarianceInput {
  productId: string;
  name?: string | null;
  ean?: string | null;
  systemQty: number;
  countedQty: number;
  costMinorUnits?: number | null;
}

export interface VarianceLine {
  productId: string;
  name: string | null;
  ean: string | null;
  systemQty: number;
  countedQty: number;
  qtyDiff: number;
  valueDiffMinorUnits: number;
  status: 'ok' | 'overage' | 'shortage';
}

export interface VarianceSummary {
  lines: VarianceLine[];
  countedProducts: number;
  discrepancyCount: number;
  shortageValueMinorUnits: number; // negative or 0
  overageValueMinorUnits: number; // positive or 0
  netValueMinorUnits: number; // overage + shortage
}

export function computeStockVariance(rows: readonly VarianceInput[]): VarianceSummary {
  const lines: VarianceLine[] = [];
  let shortage = 0;
  let overage = 0;
  let discrepancyCount = 0;

  for (const r of rows ?? []) {
    if (!r || !r.productId) continue;
    const systemQty = Math.trunc(Number(r.systemQty) || 0);
    const countedQty = Math.trunc(Number(r.countedQty) || 0);
    const qtyDiff = countedQty - systemQty;
    const cost = Number(r.costMinorUnits) || 0;
    const valueDiffMinorUnits = qtyDiff * cost || 0; // normalize -0 → 0
    if (qtyDiff !== 0) discrepancyCount += 1;
    if (valueDiffMinorUnits > 0) overage += valueDiffMinorUnits;
    else if (valueDiffMinorUnits < 0) shortage += valueDiffMinorUnits;
    lines.push({
      productId: r.productId,
      name: r.name ?? null,
      ean: r.ean ?? null,
      systemQty,
      countedQty,
      qtyDiff,
      valueDiffMinorUnits,
      status: qtyDiff === 0 ? 'ok' : qtyDiff > 0 ? 'overage' : 'shortage',
    });
  }

  // Most material discrepancies first (largest absolute value gap), then by name.
  lines.sort(
    (a, b) =>
      Math.abs(b.valueDiffMinorUnits) - Math.abs(a.valueDiffMinorUnits) ||
      (a.name ?? '').localeCompare(b.name ?? ''),
  );

  return {
    lines,
    countedProducts: lines.length,
    discrepancyCount,
    shortageValueMinorUnits: shortage,
    overageValueMinorUnits: overage,
    netValueMinorUnits: overage + shortage,
  };
}
