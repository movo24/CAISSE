/**
 * POS — Upsell V4 cash-oriented scoring (pure, unit-testable).
 * Extracted from SalesAiService.getProductAssociations (behavior-preserving):
 * the five sub-scores, the weighted confidence, margin %, stock-pressure
 * label/score, temporal score, and estimated cash impact.
 */

// ── V4 scoring weights — CASH FIRST ──
export const W_COOCCURRENCE = 0.3;
export const W_MARGIN = 0.35;
export const W_STOCK_PRESSURE = 0.15;
export const W_TEMPORAL = 0.1;
export const W_CONSISTENCY = 0.1;

export const OVERSTOCK_THRESHOLD = 50; // ≥ → overstock (push harder)
export const HEALTHY_STOCK_MIN = 20; // ≥ → healthy

export type StockPressure = 'overstock' | 'healthy' | 'low';

/** Co-occurrence strength from attachment rate + main-product volume (capped 1). */
export function coOccurrenceScore(rate: number, mainTickets: number): number {
  return Math.min(1, (rate / 0.5) * 0.6 + (mainTickets / 200) * 0.4);
}

/** Margin % of a suggested product; defaults to 50 when price is 0. */
export function marginPercentOf(price: number, cost: number): number {
  return price > 0 ? ((price - cost) / price) * 100 : 50;
}

/** Margin sub-score (capped 1 at 70% margin). */
export function marginScoreOf(marginPercent: number): number {
  return Math.min(1, marginPercent / 70);
}

/** Stock-pressure sub-score: overstock 1.0, healthy 0.7, low 0.3. */
export function stockPressureScore(stock: number): number {
  if (stock >= OVERSTOCK_THRESHOLD) return 1.0;
  if (stock >= HEALTHY_STOCK_MIN) return 0.7;
  return 0.3;
}

/** Stock-pressure label aligned with the score bands. */
export function stockPressureLabel(stock: number): StockPressure {
  if (stock >= OVERSTOCK_THRESHOLD) return 'overstock';
  if (stock >= HEALTHY_STOCK_MIN) return 'healthy';
  return 'low';
}

/** Time-of-day relevance: breakfast 0.8, lunch 0.9, evening 0.7, else 0.5. */
export function temporalScore(hour: number): number {
  if (hour >= 12 && hour <= 14) return 0.9;
  if (hour >= 7 && hour <= 9) return 0.8;
  if (hour >= 17 && hour <= 20) return 0.7;
  return 0.5;
}

/** Pattern stability sub-score (capped 1 at 30 co-occurrences). */
export function consistencyScore(coOccurrences: number): number {
  return Math.min(1, coOccurrences / 30);
}

/** Weighted V4 confidence (0–1). */
export function upsellConfidence(s: {
  coOccurrence: number;
  margin: number;
  stockPressure: number;
  temporal: number;
  consistency: number;
}): number {
  return (
    s.coOccurrence * W_COOCCURRENCE +
    s.margin * W_MARGIN +
    s.stockPressure * W_STOCK_PRESSURE +
    s.temporal * W_TEMPORAL +
    s.consistency * W_CONSISTENCY
  );
}

/** Estimated margin in cents per accepted reco. */
export function estimatedCashImpact(marginPercent: number, price: number): number {
  return Math.round((marginPercent / 100) * price);
}
