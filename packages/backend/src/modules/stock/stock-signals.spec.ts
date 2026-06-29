import { summarizeStockSignals, toStockSignalEvents, StockSignalEvent } from './stock-signals';

const mv = (productId: string, qty: number, at: string, extra: Partial<StockSignalEvent> = {}): StockSignalEvent => ({
  productId, productName: productId, ean: null, type: 'stock.movement', newQuantity: qty, deltaQuantity: -1, occurredAt: at, ...extra,
});

describe('stock-signals (POS-INT-119)', () => {
  it('keeps the latest quantity per product and counts movements', () => {
    const s = summarizeStockSignals([
      mv('p1', 5, '2026-06-29T09:00:00.000Z'),
      mv('p1', 3, '2026-06-29T10:00:00.000Z'),
    ]);
    expect(s.products).toHaveLength(1);
    expect(s.products[0]).toMatchObject({ productId: 'p1', lastQuantity: 3, movementCount: 2, status: 'ok' });
  });

  it('derives low status from latest quantity vs threshold', () => {
    const s = summarizeStockSignals([
      mv('p1', 3, '2026-06-29T10:00:00.000Z', { type: 'stock.low', lowStockThreshold: 5 }),
    ]);
    expect(s.products[0].status).toBe('low');
    expect(s.lowCount).toBe(1);
  });

  it('derives depleted at 0', () => {
    const s = summarizeStockSignals([mv('p1', 0, '2026-06-29T10:00:00.000Z', { type: 'stock.depleted' })]);
    expect(s.products[0].status).toBe('depleted');
    expect(s.depletedCount).toBe(1);
  });

  it('a later replenishment movement clears a prior low/depleted', () => {
    const s = summarizeStockSignals([
      mv('p1', 0, '2026-06-29T10:00:00.000Z', { type: 'stock.depleted' }),
      mv('p1', 12, '2026-06-29T11:00:00.000Z', { deltaQuantity: 12, lowStockThreshold: 5 }),
    ]);
    expect(s.products[0]).toMatchObject({ lastQuantity: 12, status: 'ok' });
    expect(s.depletedCount).toBe(0);
  });

  it('orders by urgency: depleted, low, ok', () => {
    const s = summarizeStockSignals([
      mv('ok1', 50, '2026-06-29T09:00:00.000Z'),
      mv('low1', 2, '2026-06-29T09:00:00.000Z', { type: 'stock.low', lowStockThreshold: 5 }),
      mv('dep1', 0, '2026-06-29T09:00:00.000Z', { type: 'stock.depleted' }),
    ]);
    expect(s.products.map((p) => p.status)).toEqual(['depleted', 'low', 'ok']);
  });

  describe('toStockSignalEvents', () => {
    it('extracts stock.* rows and ignores others', () => {
      const rows = [
        { type: 'stock.low', occurredAt: 'x', payload: { productId: 'p1', productName: 'Bonbon', newQuantity: 3, deltaQuantity: -1, lowStockThreshold: 5 } },
        { type: 'sale.completed', payload: { ticketNumber: 'T1' } },
      ];
      const ev = toStockSignalEvents(rows);
      expect(ev).toHaveLength(1);
      expect(ev[0]).toMatchObject({ productId: 'p1', type: 'stock.low', newQuantity: 3, lowStockThreshold: 5 });
      expect(summarizeStockSignals(ev).products[0].status).toBe('low');
    });

    it('skips rows without a product id', () => {
      expect(toStockSignalEvents([{ type: 'stock.movement', payload: {} }])).toEqual([]);
    });
  });
});
