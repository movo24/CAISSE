import { describe, it, expect } from 'vitest';
import { stockSeverityRank, sortByStockSeverity, onlyDiscrepancies } from './severity';

describe('severity (POS-FE-167)', () => {
  it('ranks depleted > low > ok > unknown', () => {
    expect(stockSeverityRank('depleted')).toBe(2);
    expect(stockSeverityRank('low')).toBe(1);
    expect(stockSeverityRank('ok')).toBe(0);
    expect(stockSeverityRank('???')).toBe(0);
    expect(stockSeverityRank(null)).toBe(0);
  });

  it('sorts most urgent first without mutating input', () => {
    const input = [{ status: 'ok' }, { status: 'depleted' }, { status: 'low' }];
    const out = sortByStockSeverity(input);
    expect(out.map((r) => r.status)).toEqual(['depleted', 'low', 'ok']);
    expect(input.map((r) => r.status)).toEqual(['ok', 'depleted', 'low']); // unchanged
  });

  it('filters to discrepancies only', () => {
    const rows = [{ qtyDiff: 0 }, { qtyDiff: -2 }, { qtyDiff: 3 }];
    expect(onlyDiscrepancies(rows)).toEqual([{ qtyDiff: -2 }, { qtyDiff: 3 }]);
  });

  it('handles empty/nullish', () => {
    expect(sortByStockSeverity(undefined as any)).toEqual([]);
    expect(onlyDiscrepancies(undefined as any)).toEqual([]);
  });
});
