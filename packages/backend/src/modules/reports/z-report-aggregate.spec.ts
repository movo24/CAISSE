import { aggregateZReport, ZSaleInput } from './z-report-aggregate';

describe('POS-122 aggregateZReport', () => {
  const sales: ZSaleInput[] = [
    {
      totalMinorUnits: 1000,
      taxTotalMinorUnits: 167,
      discountTotalMinorUnits: 0,
      createdAt: '2026-06-28T09:30:00',
      payments: [{ method: 'cash', amountMinorUnits: 1000 }],
      lineItems: [
        { productId: 'A', productName: 'Coca', quantity: 2, lineTotalMinorUnits: 600 },
        { productId: 'B', productName: 'Eau', quantity: 1, lineTotalMinorUnits: 400 },
      ],
    },
    {
      totalMinorUnits: 500,
      taxTotalMinorUnits: 83,
      discountTotalMinorUnits: 50,
      createdAt: '2026-06-28T09:45:00',
      payments: [{ method: 'card', amountMinorUnits: 500 }],
      lineItems: [
        { productId: 'A', productName: 'Coca', quantity: 1, lineTotalMinorUnits: 300 },
      ],
    },
  ];

  it('sums revenue/tax/discount', () => {
    const a = aggregateZReport(sales);
    expect(a.totalRevenueMinorUnits).toBe(1500);
    expect(a.totalTaxMinorUnits).toBe(250);
    expect(a.totalDiscountMinorUnits).toBe(50);
  });
  it('splits cash vs card', () => {
    const a = aggregateZReport(sales);
    expect(a.cashTotalMinorUnits).toBe(1000);
    expect(a.cardTotalMinorUnits).toBe(500);
  });
  it('average basket = revenue / tx count (rounded)', () => {
    const a = aggregateZReport(sales);
    expect(a.transactionCount).toBe(2);
    expect(a.averageBasketMinorUnits).toBe(750);
  });
  it('top products aggregated and sorted by revenue', () => {
    const a = aggregateZReport(sales);
    expect(a.topProducts[0]).toMatchObject({ productId: 'A', quantity: 3, revenueMinorUnits: 900 });
    expect(a.topProducts[1]).toMatchObject({ productId: 'B', revenueMinorUnits: 400 });
  });
  it('peak hours counts transactions per hour', () => {
    const a = aggregateZReport(sales);
    expect(a.peakHours[0]).toEqual({ hour: 9, transactionCount: 2 });
  });
  it('empty day = zeros and avg 0', () => {
    const a = aggregateZReport([]);
    expect(a.totalRevenueMinorUnits).toBe(0);
    expect(a.averageBasketMinorUnits).toBe(0);
    expect(a.transactionCount).toBe(0);
  });
});
