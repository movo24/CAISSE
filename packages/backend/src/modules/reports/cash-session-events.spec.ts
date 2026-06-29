import { buildCashSessionClosedEvent } from './cash-session-events';

describe('POS reports cash-session-events', () => {
  it('builds cash_session.closed mirroring the frozen Z figures', () => {
    const e = buildCashSessionClosedEvent({
      zReportId: 'z-1',
      storeId: 'store-1',
      employeeId: 'emp-1',
      date: '2026-06-29',
      currencyCode: 'EUR',
      totalRevenueMinorUnits: 120000,
      totalTaxMinorUnits: 20000,
      cashTotalMinorUnits: 50000,
      cardTotalMinorUnits: 70000,
      discountTotalMinorUnits: 3000,
      transactionCount: 42,
      averageBasketMinorUnits: 2857,
      voidCount: 1,
      occurredAt: '2026-06-29T20:00:00.000Z',
    });
    expect(e.type).toBe('cash_session.closed');
    expect(e.aggregateType).toBe('cash_session');
    expect(e.aggregateId).toBe('z-1');
    expect(e.payload).toMatchObject({
      date: '2026-06-29',
      totalRevenueMinorUnits: 120000,
      totalTaxMinorUnits: 20000,
      cashTotalMinorUnits: 50000,
      cardTotalMinorUnits: 70000,
      transactionCount: 42,
      voidCount: 1,
    });
    expect(e.occurredAt).toBe('2026-06-29T20:00:00.000Z');
  });
});
