import { computeStockVariance } from './stock-variance';

describe('stock-variance (POS-INT-151)', () => {
  it('computes qty + value diff per line, signed', () => {
    const s = computeStockVariance([
      { productId: 'p1', name: 'A', systemQty: 10, countedQty: 8, costMinorUnits: 100 },  // shortage -2 → -200
      { productId: 'p2', name: 'B', systemQty: 5, countedQty: 7, costMinorUnits: 50 },     // overage +2 → +100
      { productId: 'p3', name: 'C', systemQty: 3, countedQty: 3, costMinorUnits: 999 },    // ok
    ]);
    const byId = Object.fromEntries(s.lines.map((l) => [l.productId, l]));
    expect(byId.p1).toMatchObject({ qtyDiff: -2, valueDiffMinorUnits: -200, status: 'shortage' });
    expect(byId.p2).toMatchObject({ qtyDiff: 2, valueDiffMinorUnits: 100, status: 'overage' });
    expect(byId.p3).toMatchObject({ qtyDiff: 0, valueDiffMinorUnits: 0, status: 'ok' });
  });

  it('aggregates shortage/overage/net + discrepancy count', () => {
    const s = computeStockVariance([
      { productId: 'p1', systemQty: 10, countedQty: 8, costMinorUnits: 100 }, // -200
      { productId: 'p2', systemQty: 5, countedQty: 7, costMinorUnits: 50 },   // +100
      { productId: 'p3', systemQty: 3, countedQty: 3, costMinorUnits: 999 },  // 0
    ]);
    expect(s.countedProducts).toBe(3);
    expect(s.discrepancyCount).toBe(2);
    expect(s.shortageValueMinorUnits).toBe(-200);
    expect(s.overageValueMinorUnits).toBe(100);
    expect(s.netValueMinorUnits).toBe(-100);
  });

  it('missing cost → value diff 0 (qty diff still reported)', () => {
    const s = computeStockVariance([{ productId: 'p1', systemQty: 10, countedQty: 4 }]);
    expect(s.lines[0]).toMatchObject({ qtyDiff: -6, valueDiffMinorUnits: 0, status: 'shortage' });
    expect(s.netValueMinorUnits).toBe(0);
  });

  it('orders by largest absolute value gap first', () => {
    const s = computeStockVariance([
      { productId: 'small', systemQty: 1, countedQty: 0, costMinorUnits: 100 },   // -100
      { productId: 'big', systemQty: 10, countedQty: 0, costMinorUnits: 1000 },   // -10000
    ]);
    expect(s.lines.map((l) => l.productId)).toEqual(['big', 'small']);
  });

  it('skips rows without productId; truncates fractional qty', () => {
    const s = computeStockVariance([
      { productId: '', systemQty: 5, countedQty: 1 } as any,
      { productId: 'p1', systemQty: 5.9 as any, countedQty: 3.2 as any, costMinorUnits: 100 },
    ]);
    expect(s.countedProducts).toBe(1);
    expect(s.lines[0]).toMatchObject({ systemQty: 5, countedQty: 3, qtyDiff: -2 });
  });
});
