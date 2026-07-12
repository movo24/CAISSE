/**
 * Edge-triggered low/critical stock alert detection (sale path).
 *
 * The sale decrements stock inline (bypassing StockService.decrementStock), so the
 * at-sale-time low/critical alert had to be restored. This proves the crossing rule:
 * an alert fires ONLY on the decrement that crosses a threshold (old strictly above,
 * new at or below), never while already below, with critical taking precedence.
 */
import { detectStockThresholdCrossing } from '../src/modules/sales/stock-threshold.util';

describe('detectStockThresholdCrossing (edge-triggered)', () => {
  const T = { alertThreshold: 5, criticalThreshold: 2 };

  it('fires ALERT when the sale crosses the low threshold from above', () => {
    // 7 → 4 : was above 5, now at/below 5 (but above critical 2) → alert
    expect(detectStockThresholdCrossing({ oldStock: 7, newStock: 4, ...T })).toBe('alert');
  });

  it('fires ALERT exactly at the boundary (new === alertThreshold)', () => {
    expect(detectStockThresholdCrossing({ oldStock: 6, newStock: 5, ...T })).toBe('alert');
  });

  it('fires CRITICAL when the sale crosses the critical threshold from above', () => {
    // 3 → 1 : was above 2, now at/below 2 → critical (takes precedence over alert)
    expect(detectStockThresholdCrossing({ oldStock: 3, newStock: 1, ...T })).toBe('critical');
  });

  it('fires CRITICAL exactly at the boundary (new === criticalThreshold)', () => {
    expect(detectStockThresholdCrossing({ oldStock: 4, newStock: 2, ...T })).toBe('critical');
  });

  it('CRITICAL wins when a single sale crosses BOTH thresholds at once', () => {
    // 10 → 1 : crosses both 5 and 2 in one decrement → critical (not alert)
    expect(detectStockThresholdCrossing({ oldStock: 10, newStock: 1, ...T })).toBe('critical');
  });

  it('does NOT fire when the product was ALREADY below the threshold (no re-alert)', () => {
    // 4 → 3 : already below 5, still above 2 → no new crossing
    expect(detectStockThresholdCrossing({ oldStock: 4, newStock: 3, ...T })).toBeNull();
    // 2 → 1 : already at/below critical → no new crossing
    expect(detectStockThresholdCrossing({ oldStock: 2, newStock: 1, ...T })).toBeNull();
  });

  it('does NOT fire when the sale stays comfortably above the low threshold', () => {
    expect(detectStockThresholdCrossing({ oldStock: 100, newStock: 90, ...T })).toBeNull();
  });

  it('does NOT fire when nothing moved (defensive, qty 0 equivalent)', () => {
    expect(detectStockThresholdCrossing({ oldStock: 4, newStock: 4, ...T })).toBeNull();
  });
});
