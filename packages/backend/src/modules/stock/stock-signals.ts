/**
 * POS-INT-119 — stock signals aggregation (pure, unit-testable).
 *
 * Folds a window of stock.* integration events (movement / low / depleted) into
 * one latest-state record per product, with a derived replenishment status. Feeds
 * Analytik R (réappro forecasting) and any read-only stock dashboard. Pure: no DB,
 * no Nest. Authoritative current quantity lives in the products table — this is a
 * consumer-side view of the event stream, ordered by occurredAt.
 */

export type StockStatus = 'ok' | 'low' | 'depleted';

export interface StockSignalEvent {
  productId: string;
  productName?: string | null;
  ean?: string | null;
  type: string; // stock.movement | stock.low | stock.depleted
  newQuantity: number;
  deltaQuantity?: number;
  lowStockThreshold?: number | null;
  occurredAt: string; // ISO
}

export interface StockSignalRecord {
  productId: string;
  productName: string | null;
  ean: string | null;
  lastQuantity: number;
  lowStockThreshold: number | null;
  movementCount: number;
  lastDeltaQuantity: number;
  lastOccurredAt: string;
  status: StockStatus;
}

export interface StockSignalSummary {
  products: StockSignalRecord[];
  lowCount: number;
  depletedCount: number;
}

function deriveStatus(qty: number, threshold: number | null): StockStatus {
  if (qty <= 0) return 'depleted';
  if (threshold != null && threshold > 0 && qty <= threshold) return 'low';
  return 'ok';
}

/**
 * Build per-product latest stock state from a window of events. Events need not
 * be pre-sorted; they are ordered by occurredAt (id-free — same-ts ties keep
 * input order, which the caller already sorts by id). Status is derived from the
 * latest quantity and the most recent known threshold.
 */
export function summarizeStockSignals(events: readonly StockSignalEvent[]): StockSignalSummary {
  const ordered = [...events].sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
  const byProduct = new Map<string, StockSignalRecord>();

  for (const e of ordered) {
    if (!e.productId) continue;
    let r = byProduct.get(e.productId);
    if (!r) {
      r = {
        productId: e.productId,
        productName: e.productName ?? null,
        ean: e.ean ?? null,
        lastQuantity: 0,
        lowStockThreshold: null,
        movementCount: 0,
        lastDeltaQuantity: 0,
        lastOccurredAt: e.occurredAt,
        status: 'ok',
      };
      byProduct.set(e.productId, r);
    }
    if (e.productName != null) r.productName = e.productName;
    if (e.ean != null) r.ean = e.ean;
    if (e.type === 'stock.movement') r.movementCount += 1;
    if (typeof e.lowStockThreshold === 'number') r.lowStockThreshold = e.lowStockThreshold;
    if (typeof e.deltaQuantity === 'number') r.lastDeltaQuantity = e.deltaQuantity;
    r.lastQuantity = Number(e.newQuantity) || 0;
    r.lastOccurredAt = e.occurredAt;
  }

  const products = [...byProduct.values()].map((r) => ({
    ...r,
    status: deriveStatus(r.lastQuantity, r.lowStockThreshold),
  }));
  // surface the most urgent first: depleted, then low, then ok; stable by name
  const rank: Record<StockStatus, number> = { depleted: 0, low: 1, ok: 2 };
  products.sort(
    (a, b) => rank[a.status] - rank[b.status] || (a.productName ?? '').localeCompare(b.productName ?? ''),
  );

  return {
    products,
    lowCount: products.filter((p) => p.status === 'low').length,
    depletedCount: products.filter((p) => p.status === 'depleted').length,
  };
}

/** Normalize raw outbox rows into StockSignalEvents (tolerant; ignores other types). */
export function toStockSignalEvents(rows: readonly any[]): StockSignalEvent[] {
  const out: StockSignalEvent[] = [];
  for (const r of rows ?? []) {
    const type = r?.type;
    if (type !== 'stock.movement' && type !== 'stock.low' && type !== 'stock.depleted') continue;
    const p = r?.payload ?? {};
    const productId = String(p.productId ?? r?.aggregateId ?? '');
    if (!productId) continue;
    out.push({
      productId,
      productName: p.productName ?? null,
      ean: p.ean ?? null,
      type,
      newQuantity: Number(p.newQuantity) || 0,
      deltaQuantity: typeof p.deltaQuantity === 'number' ? p.deltaQuantity : undefined,
      lowStockThreshold: typeof p.lowStockThreshold === 'number' ? p.lowStockThreshold : null,
      occurredAt: String(r.occurredAt ?? ''),
    });
  }
  return out;
}
