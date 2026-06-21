import { Injectable, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { SaleEntity } from '../../database/entities/sale.entity';
import { ZReportEntity } from '../../database/entities/z-report.entity';

@Injectable()
export class ReportsService {
  constructor(
    @InjectRepository(SaleEntity)
    private saleRepo: Repository<SaleEntity>,
    @InjectRepository(ZReportEntity)
    private zReportRepo: Repository<ZReportEntity>,
  ) {}

  /**
   * Shared day aggregation — the running totals for (store, date) computed from
   * the sales table. ONE source for both the Z-report (end-of-day, sealed,
   * persisted) and the X-report (intra-day, read-only snapshot). Never persists.
   */
  private async aggregateDay(
    storeId: string,
    date: string,
  ): Promise<{
    totalRevenue: number;
    totalTax: number;
    totalDiscount: number;
    cashTotal: number;
    cardTotal: number;
    transactionCount: number;
    avgBasket: number;
    voidedCount: number;
    topProducts: Array<{ productId: string; name: string; quantity: number; revenueMinorUnits: number }>;
    peakHours: Array<{ hour: number; transactionCount: number }>;
  }> {
    // Get all completed sales for the day
    const sales = await this.saleRepo
      .createQueryBuilder('s')
      .leftJoinAndSelect('s.lineItems', 'li')
      .leftJoinAndSelect('s.payments', 'p')
      .where('s.store_id = :storeId', { storeId })
      .andWhere('DATE(s.created_at) = :date', { date })
      .andWhere('s.status = :status', { status: 'completed' })
      .getMany();

    const voidedCount = await this.saleRepo
      .createQueryBuilder('s')
      .where('s.store_id = :storeId', { storeId })
      .andWhere('DATE(s.created_at) = :date', { date })
      .andWhere('s.status = :status', { status: 'voided' })
      .getCount();

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

    const avgBasket = sales.length > 0 ? Math.round(totalRevenue / sales.length) : 0;

    return {
      totalRevenue,
      totalTax,
      totalDiscount,
      cashTotal,
      cardTotal,
      transactionCount: sales.length,
      avgBasket,
      voidedCount,
      topProducts,
      peakHours,
    };
  }

  async generateZReport(
    storeId: string,
    date: string,
    employeeId: string,
  ): Promise<ZReportEntity> {
    // Check if already exists
    const existing = await this.zReportRepo.findOne({
      where: { storeId, date },
    });
    if (existing)
      throw new BadRequestException('Z-Report already exists for this date');

    const agg = await this.aggregateDay(storeId, date);

    const zReport = this.zReportRepo.create({
      id: uuidv4(),
      storeId,
      date,
      employeeId,
      totalRevenueMinorUnits: agg.totalRevenue,
      totalTaxMinorUnits: agg.totalTax,
      currencyCode: 'EUR',
      cashTotalMinorUnits: agg.cashTotal,
      cardTotalMinorUnits: agg.cardTotal,
      transactionCount: agg.transactionCount,
      averageBasketMinorUnits: agg.avgBasket,
      topProducts: agg.topProducts,
      voidCount: agg.voidedCount,
      discountTotalMinorUnits: agg.totalDiscount,
      peakHours: agg.peakHours,
    });

    return this.zReportRepo.save(zReport);
  }

  /**
   * X-REPORT — intra-day snapshot (Bloc 9d). The same running totals as the Z,
   * but READ-ONLY: it never persists, never seals, never resets, and is
   * repeatable any number of times during the day. NON-fiscal — the Z remains
   * the sealed fiscal close. Flags whether the day's Z has already been taken.
   */
  async generateXReport(storeId: string, date: string): Promise<{
    type: 'X';
    storeId: string;
    date: string;
    snapshotAt: string;
    sealed: false;
    zReportExists: boolean;
    note: string;
    totalRevenueMinorUnits: number;
    totalTaxMinorUnits: number;
    discountTotalMinorUnits: number;
    cashTotalMinorUnits: number;
    cardTotalMinorUnits: number;
    transactionCount: number;
    averageBasketMinorUnits: number;
    voidCount: number;
    topProducts: Array<{ productId: string; name: string; quantity: number; revenueMinorUnits: number }>;
    peakHours: Array<{ hour: number; transactionCount: number }>;
  }> {
    const agg = await this.aggregateDay(storeId, date);
    const zReportExists = !!(await this.zReportRepo.findOne({ where: { storeId, date } }));
    return {
      type: 'X',
      storeId,
      date,
      snapshotAt: new Date().toISOString(),
      sealed: false,
      zReportExists,
      note: 'Snapshot intra-journée (rapport X) — non fiscal : ne scelle ni ne remet à zéro, répétable. Le rapport Z reste la pièce de clôture fiscale.',
      totalRevenueMinorUnits: agg.totalRevenue,
      totalTaxMinorUnits: agg.totalTax,
      discountTotalMinorUnits: agg.totalDiscount,
      cashTotalMinorUnits: agg.cashTotal,
      cardTotalMinorUnits: agg.cardTotal,
      transactionCount: agg.transactionCount,
      averageBasketMinorUnits: agg.avgBasket,
      voidCount: agg.voidedCount,
      topProducts: agg.topProducts,
      peakHours: agg.peakHours,
    };
  }

  async getZReport(
    storeId: string,
    date: string,
  ): Promise<ZReportEntity | null> {
    return this.zReportRepo.findOne({ where: { storeId, date } });
  }

  async getDailySummary(
    storeId: string,
    startDate: string,
    endDate: string,
  ): Promise<ZReportEntity[]> {
    return this.zReportRepo
      .createQueryBuilder('z')
      .where('z.store_id = :storeId', { storeId })
      .andWhere('z.date >= :startDate', { startDate })
      .andWhere('z.date <= :endDate', { endDate })
      .orderBy('z.date', 'ASC')
      .getMany();
  }

  /**
   * Get real-time store KPIs from sales table (not from Z-reports).
   * Used by the dashboard to show live data per store.
   */
  async getStoreKpi(storeId: string, date: string) {
    const result = await this.saleRepo
      .createQueryBuilder('s')
      .select('COUNT(s.id)', 'transactionCount')
      .addSelect('COALESCE(SUM(s.totalMinorUnits), 0)', 'totalRevenueMinorUnits')
      .addSelect('COALESCE(SUM(s.discountTotalMinorUnits), 0)', 'discountTotalMinorUnits')
      .where('s.storeId = :storeId', { storeId })
      .andWhere('DATE(s.completedAt) = :date', { date })
      .andWhere("s.status = 'completed'")
      .getRawOne();

    const txCount = parseInt(result?.transactionCount || '0', 10);
    const totalRevenue = parseInt(result?.totalRevenueMinorUnits || '0', 10);
    const avgBasket = txCount > 0 ? Math.round(totalRevenue / txCount) : 0;

    return {
      storeId,
      date,
      transactionCount: txCount,
      totalRevenueMinorUnits: totalRevenue,
      discountTotalMinorUnits: parseInt(result?.discountTotalMinorUnits || '0', 10),
      averageBasketMinorUnits: avgBasket,
    };
  }
}
