import { aggregatePaymentsByMethod } from './payments-breakdown';

describe('POS-102 aggregatePaymentsByMethod', () => {
  const sales = [
    { payments: [{ method: 'cash', amountMinorUnits: 1000 }] },
    { payments: [
      { method: 'card', amountMinorUnits: 2000 },
      { method: 'store_credit', amountMinorUnits: 500 },
    ] },
    { payments: [{ method: 'cash', amountMinorUnits: 1500 }] },
  ];

  it('aggregates count + total per method', () => {
    const rows = aggregatePaymentsByMethod(sales);
    const cash = rows.find((r) => r.method === 'cash')!;
    expect(cash.count).toBe(2);
    expect(cash.totalMinorUnits).toBe(2500);
  });

  it('sorts by total desc', () => {
    const rows = aggregatePaymentsByMethod(sales);
    expect(rows[0].method).toBe('cash'); // 2500
    expect(rows[1].method).toBe('card'); // 2000
    expect(rows[2].method).toBe('store_credit'); // 500
  });

  it('handles empty / missing payments', () => {
    expect(aggregatePaymentsByMethod([])).toEqual([]);
    expect(aggregatePaymentsByMethod([{ payments: [] as any }])).toEqual([]);
  });
});
