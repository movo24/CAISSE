/**
 * Edge-triggered stock-alert band crossing (sale path).
 *
 * The sale's stock alert (audit + TW24 manager push) used to fire on EVERY sale
 * while the product sat below a threshold. This proves the edge-triggered rule:
 * an alert fires only when a sale moves the product into a strictly MORE severe
 * band; staying in the same band (or recovering) fires nothing; escalation within
 * the low zone (alert → critical → out_of_stock) still fires.
 */
import {
  classifyStockBand,
  stockCrossingBand,
} from '../src/modules/sales/stock-alert-crossing.util';

const A = 5; // alert threshold
const C = 2; // critical threshold

describe('classifyStockBand', () => {
  it('classifies each band by quantity', () => {
    expect(classifyStockBand(10, A, C)).toBe('none');
    expect(classifyStockBand(5, A, C)).toBe('alert');
    expect(classifyStockBand(3, A, C)).toBe('alert');
    expect(classifyStockBand(2, A, C)).toBe('critical');
    expect(classifyStockBand(1, A, C)).toBe('critical');
    expect(classifyStockBand(0, A, C)).toBe('out_of_stock');
  });
});

describe('stockCrossingBand (edge-triggered)', () => {
  it('fires ALERT when a sale crosses the low threshold from above', () => {
    expect(stockCrossingBand(7, 4, A, C)).toBe('alert'); // none → alert
    expect(stockCrossingBand(6, 5, A, C)).toBe('alert'); // boundary
  });

  it('fires CRITICAL when a sale crosses the critical threshold from the alert zone', () => {
    expect(stockCrossingBand(4, 1, A, C)).toBe('critical'); // alert → critical
    expect(stockCrossingBand(4, 2, A, C)).toBe('critical'); // boundary
  });

  it('fires OUT_OF_STOCK when a sale empties the product', () => {
    expect(stockCrossingBand(3, 0, A, C)).toBe('out_of_stock'); // alert → oos
    expect(stockCrossingBand(1, 0, A, C)).toBe('out_of_stock'); // critical → oos
  });

  it('escalates directly across two bands in one sale (none → critical)', () => {
    expect(stockCrossingBand(10, 1, A, C)).toBe('critical');
  });

  it('does NOT re-fire while staying in the SAME band', () => {
    expect(stockCrossingBand(4, 3, A, C)).toBeNull(); // alert → alert
    expect(stockCrossingBand(2, 1, A, C)).toBeNull(); // critical → critical
  });

  it('does NOT fire when the sale stays comfortably above the low threshold', () => {
    expect(stockCrossingBand(100, 90, A, C)).toBeNull(); // none → none
  });

  it('does NOT fire on a no-op or a recovery (never less severe)', () => {
    expect(stockCrossingBand(4, 4, A, C)).toBeNull(); // no movement
    expect(stockCrossingBand(1, 3, A, C)).toBeNull(); // recovery critical → alert
  });
});
