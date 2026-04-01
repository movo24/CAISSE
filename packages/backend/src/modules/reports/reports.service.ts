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

    // Calculate totals
    let totalRevenue = 0;
    let totalTax = 0;
    let totalDiscount = 0;
    let cashTotal = 0;
    let cardTotal = 0;
    const productSales: Record<
      string,
      { name: string; quantity: number; revenue: number }
    > = {};
    const hourCounts: Record<number, number> = {};

    for (const sale of sales) {
      totalRevenue += sale.totalMinorUnits;
      totalTax += sale.taxTotalMinorUnits;
      totalDiscount += sale.discountTotalMinorUnits;

      for (const payment of sale.payments) {
        if (payment.method === 'cash') cashTotal += payment.amountMinorUnits;
        else if (payment.method === 'card')
          cardTotal += payment.amountMinorUnits;
      }

      for (const item of sale.lineItems) {
        if (!productSales[item.productId]) {
          productSales[item.productId] = {
            name: item.productName,
            quantity: 0,
            revenue: 0,
          };
        }
        productSales[item.productId].quantity += item.quantity;
        productSales[item.productId].revenue += item.lineTotalMinorUnits;
      }

      const hour = new Date(sale.createdAt).getHours();
      hourCounts[hour] = (hourCounts[hour] || 0) + 1;
    }

    // Top products by revenue
    const topProducts = Object.entries(productSales)
      .map(([productId, data]) => ({
        productId,
        name: data.name,
        quantity: data.quantity,
        revenueMinorUnits: data.revenue,
      }))
      .sort((a, b) => b.revenueMinorUnits - a.revenueMinorUnits)
      .slice(0, 10);

    // Peak hours
    const peakHours = Object.entries(hourCounts)
      .map(([hour, count]) => ({
        hour: parseInt(hour),
        transactionCount: count,
      }))
      .sort((a, b) => b.transactionCount - a.transactionCount);

    const avgBasket =
      sales.length > 0 ? Math.round(totalRevenue / sales.length) : 0;

    const zReport = this.zReportRepo.create({
      id: uuidv4(),
      storeId,
      date,
      employeeId,
      totalRevenueMinorUnits: totalRevenue,
      totalTaxMinorUnits: totalTax,
      currencyCode: 'EUR',
      cashTotalMinorUnits: cashTotal,
      cardTotalMinorUnits: cardTotal,
      transactionCount: sales.length,
      averageBasketMinorUnits: avgBasket,
      topProducts,
      voidCount: voidedCount,
      discountTotalMinorUnits: totalDiscount,
      peakHours,
    });

    return this.zReportRepo.save(zReport);
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
