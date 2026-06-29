import { buildStockEvents } from './stock-events';

const base = {
  productId: 'p-1', storeId: 'store-1', employeeId: 'emp-1',
  ean: '111', productName: 'Bonbon', reason: 'sale_decrement', occurredAt: '2026-06-29T10:00:00.000Z',
};

describe('POS stock-events', () => {
  it('emits stock.movement with delta + new quantity', () => {
    const evs = buildStockEvents({ ...base, newQuantity: 5, deltaQuantity: -2 });
    expect(evs).toHaveLength(1);
    expect(evs[0].type).toBe('stock.movement');
    expect(evs[0].aggregateType).toBe('stock');
    expect(evs[0].aggregateId).toBe('p-1');
    expect(evs[0].payload).toMatchObject({ newQuantity: 5, deltaQuantity: -2, reason: 'sale_decrement', ean: '111' });
  });

  it('adds stock.depleted when quantity hits 0 (rupture)', () => {
    const evs = buildStockEvents({ ...base, newQuantity: 0, deltaQuantity: -3 });
    expect(evs.map((e) => e.type)).toEqual(['stock.movement', 'stock.depleted']);
  });

  it('no depleted event when stock remains positive', () => {
    const evs = buildStockEvents({ ...base, newQuantity: 1, deltaQuantity: -1 });
    expect(evs.some((e) => e.type === 'stock.depleted')).toBe(false);
  });
});
