/**
 * POS-122 — Z-report aggregation (pure, unit-testable).
 * Extracted from ReportsService.generateZReport (behavior-preserving). Consumes the
 * already-frozen completed sales of the day and computes the Z-report figures.
 * The Z-report itself stays immutable once generated (no recompute after the fact).
 */

export interface ZSaleInput {
  totalMinorUnits: number;
  taxTotalMinorUnits: number;
  discountTotalMinorUnits: number;
  createdAt: Date | string;
  payments: { method: string; amountMinorUnits: number }[];
  lineItems: {
    productId: string;
    productName: string;
    quantity: number;
    lineTotalMinorUnits: number;
  }[];
}

export interface ZReportAggregate {
  totalRevenueMinorUnits: number;
  totalTaxMinorUnits: number;
  totalDiscountMinorUnits: number;
  cashTotalMinorUnits: number;
  cardTotalMinorUnits: number;
  transactionCount: number;
  averageBasketMinorUnits: number;
  topProducts: {
    productId: string;
    name: string;
    quantity: number;
    revenueMinorUnits: number;
  }[];
  peakHours: { hour: number; transactionCount: number }[];
}

export function aggregateZReport(sales: ZSaleInput[]): ZReportAggregate {
  let totalRevenue = 0;
  let totalTax = 0;
  let totalDiscount = 0;
  let cashTotal = 0;
  let cardTotal = 0;
  const productSales: Record<string, { name: string; quantity: number; revenue: number }> = {};
  const hourCounts: Record<number, number> = {};

  for (const sale of sales) {
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

    const hour = new Date(sale.createdAt).getHours();
    hourCounts[hour] = (hourCounts[hour] || 0) + 1;
  }

  const topProducts = Object.entries(productSales)
    .map(([productId, data]) => ({
      productId,
      name: data.name,
      quantity: data.quantity,
      revenueMinorUnits: data.revenue,
    }))
    .sort((a, b) => b.revenueMinorUnits - a.revenueMinorUnits)
    .slice(0, 10);

  const peakHours = Object.entries(hourCounts)
    .map(([hour, count]) => ({ hour: parseInt(hour), transactionCount: count }))
    .sort((a, b) => b.transactionCount - a.transactionCount);

  const averageBasketMinorUnits =
    sales.length > 0 ? Math.round(totalRevenue / sales.length) : 0;

  return {
    totalRevenueMinorUnits: totalRevenue,
    totalTaxMinorUnits: totalTax,
    totalDiscountMinorUnits: totalDiscount,
    cashTotalMinorUnits: cashTotal,
    cardTotalMinorUnits: cardTotal,
    transactionCount: sales.length,
    averageBasketMinorUnits,
    topProducts,
    peakHours,
  };
}
