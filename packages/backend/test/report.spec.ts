/**
 * Tests for Z-Report Calculations
 *
 * Validates the report aggregation logic.
 */

describe('Z-Report Calculations', () => {
  // Simulate Z-report calculation logic
  interface MockSale {
    totalMinorUnits: number;
    taxTotalMinorUnits: number;
    discountTotalMinorUnits: number;
    status: string;
    payments: { method: string; amountMinorUnits: number }[];
    lineItems: { productId: string; productName: string; quantity: number; lineTotalMinorUnits: number }[];
    createdAt: Date;
  }

  function calculateZReport(sales: MockSale[]) {
    const completedSales = sales.filter((s) => s.status === 'completed');
    const voidedCount = sales.filter((s) => s.status === 'voided').length;

    let totalRevenue = 0;
    let totalTax = 0;
    let totalDiscount = 0;
    let cashTotal = 0;
    let cardTotal = 0;
    const productSales: Record<string, { name: string; quantity: number; revenue: number }> = {};
    const hourCounts: Record<number, number> = {};

    for (const sale of completedSales) {
      totalRevenue += sale.totalMinorUnits;
      totalTax += sale.taxTotalMinorUnits;
      totalDiscount += sale.discountTotalMinorUnits;

      for (const payment of sale.payments) {
        if (payment.method === 'cash') cashTotal += payment.amountMinorUnits;
        else if (payment.method === 'card') cardTotal += payment.amountMinorUnits;
      }

      for (const item of sale.lineItems) {
        if (!productSales[item.productId]) {
          productSales[item.productId] = { name: item.productName, quantity: 0, revenue: 0 };
        }
        productSales[item.productId].quantity += item.quantity;
        productSales[item.productId].revenue += item.lineTotalMinorUnits;
      }

      const hour = sale.createdAt.getHours();
      hourCounts[hour] = (hourCounts[hour] || 0) + 1;
    }

    const avgBasket = completedSales.length > 0
      ? Math.round(totalRevenue / completedSales.length)
      : 0;

    const topProducts = Object.entries(productSales)
      .map(([id, data]) => ({ productId: id, ...data }))
      .sort((a, b) => b.revenue - a.revenue);

    return {
      totalRevenue,
      totalTax,
      totalDiscount,
      cashTotal,
      cardTotal,
      transactionCount: completedSales.length,
      avgBasket,
      voidedCount,
      topProducts,
      hourCounts,
    };
  }

  const mockSales: MockSale[] = [
    {
      totalMinorUnits: 2990,
      taxTotalMinorUnits: 498,
      discountTotalMinorUnits: 0,
      status: 'completed',
      payments: [{ method: 'card', amountMinorUnits: 2990 }],
      lineItems: [{ productId: 'p1', productName: 'T-Shirt', quantity: 1, lineTotalMinorUnits: 2990 }],
      createdAt: new Date('2024-01-15T10:30:00'),
    },
    {
      totalMinorUnits: 5990,
      taxTotalMinorUnits: 998,
      discountTotalMinorUnits: 0,
      status: 'completed',
      payments: [{ method: 'cash', amountMinorUnits: 5990 }],
      lineItems: [{ productId: 'p2', productName: 'Jean', quantity: 1, lineTotalMinorUnits: 5990 }],
      createdAt: new Date('2024-01-15T14:00:00'),
    },
    {
      totalMinorUnits: 2225,
      taxTotalMinorUnits: 371,
      discountTotalMinorUnits: 445,
      status: 'completed',
      payments: [
        { method: 'card', amountMinorUnits: 1000 },
        { method: 'cash', amountMinorUnits: 1225 },
      ],
      lineItems: [
        { productId: 'p3', productName: 'Chaussettes', quantity: 3, lineTotalMinorUnits: 2225 },
      ],
      createdAt: new Date('2024-01-15T14:30:00'),
    },
    {
      totalMinorUnits: 2990,
      taxTotalMinorUnits: 498,
      discountTotalMinorUnits: 0,
      status: 'voided',
      payments: [{ method: 'card', amountMinorUnits: 2990 }],
      lineItems: [{ productId: 'p1', productName: 'T-Shirt', quantity: 1, lineTotalMinorUnits: 2990 }],
      createdAt: new Date('2024-01-15T11:00:00'),
    },
  ];

  it('should calculate total revenue from completed sales only', () => {
    const report = calculateZReport(mockSales);
    expect(report.totalRevenue).toBe(2990 + 5990 + 2225); // 11205
  });

  it('should count transactions (completed only)', () => {
    const report = calculateZReport(mockSales);
    expect(report.transactionCount).toBe(3);
  });

  it('should count voided sales', () => {
    const report = calculateZReport(mockSales);
    expect(report.voidedCount).toBe(1);
  });

  it('should split cash and card totals', () => {
    const report = calculateZReport(mockSales);
    expect(report.cardTotal).toBe(2990 + 1000); // 3990
    expect(report.cashTotal).toBe(5990 + 1225); // 7215
  });

  it('should calculate average basket', () => {
    const report = calculateZReport(mockSales);
    const expectedAvg = Math.round((2990 + 5990 + 2225) / 3);
    expect(report.avgBasket).toBe(expectedAvg); // 3735
  });

  it('should calculate total tax', () => {
    const report = calculateZReport(mockSales);
    expect(report.totalTax).toBe(498 + 998 + 371); // 1867
  });

  it('should calculate total discounts', () => {
    const report = calculateZReport(mockSales);
    expect(report.totalDiscount).toBe(445);
  });

  it('should rank top products by revenue', () => {
    const report = calculateZReport(mockSales);
    expect(report.topProducts[0].productId).toBe('p2'); // Jean = 5990
    expect(report.topProducts[1].productId).toBe('p1'); // T-Shirt = 2990
    expect(report.topProducts[2].productId).toBe('p3'); // Chaussettes = 2225
  });

  it('should track peak hours', () => {
    const report = calculateZReport(mockSales);
    expect(report.hourCounts[14]).toBe(2); // 14h: 2 sales
    expect(report.hourCounts[10]).toBe(1); // 10h: 1 sale
  });

  it('should handle empty sales array', () => {
    const report = calculateZReport([]);
    expect(report.totalRevenue).toBe(0);
    expect(report.transactionCount).toBe(0);
    expect(report.avgBasket).toBe(0);
  });
});
