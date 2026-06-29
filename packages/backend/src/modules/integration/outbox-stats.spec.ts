import { shapeOutboxStats } from './outbox-stats';

describe('POS integration outbox-stats', () => {
  it('aggregates totals per status and per type', () => {
    const s = shapeOutboxStats([
      { status: 'published', type: 'sale.completed', count: 10 },
      { status: 'pending', type: 'sale.completed', count: 2 },
      { status: 'failed', type: 'payment.captured', count: 1 },
      { status: 'published', type: 'payment.captured', count: 10 },
    ]);
    expect(s.total).toBe(23);
    expect(s.byStatus).toEqual({ published: 20, pending: 2, failed: 1 });
    expect(s.byType).toEqual({ 'sale.completed': 12, 'payment.captured': 11 });
    expect(s.backlog).toBe(3); // pending + failed
  });

  it('empty → zeros', () => {
    expect(shapeOutboxStats([])).toEqual({ total: 0, byStatus: {}, byType: {}, backlog: 0 });
  });

  it('coerces string counts (SQL COUNT returns text)', () => {
    const s = shapeOutboxStats([{ status: 'pending', type: 'x', count: '5' as any }]);
    expect(s.total).toBe(5);
    expect(s.backlog).toBe(5);
  });
});
