import { Injectable, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { SaleEntity } from '../../database/entities/sale.entity';
import { ZReportEntity } from '../../database/entities/z-report.entity';
import { aggregateZReport } from './z-report-aggregate';
import { aggregateSalesByEmployee } from './sales-by-employee';
import { buildDailyAccountingExport, toAccountingCsv } from './accounting-export';
import { aggregatePaymentsByMethod } from './payments-breakdown';

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

    // Calculate totals (pure, unit-tested aggregator — POS-122).
    const agg = aggregateZReport(sales as any);

    const zReport = this.zReportRepo.create({
      id: uuidv4(),
      storeId,
      date,
      employeeId,
      totalRevenueMinorUnits: agg.totalRevenueMinorUnits,
      totalTaxMinorUnits: agg.totalTaxMinorUnits,
      currencyCode: 'EUR',
      cashTotalMinorUnits: agg.cashTotalMinorUnits,
      cardTotalMinorUnits: agg.cardTotalMinorUnits,
      transactionCount: agg.transactionCount,
      averageBasketMinorUnits: agg.averageBasketMinorUnits,
      topProducts: agg.topProducts,
      voidCount: voidedCount,
      discountTotalMinorUnits: agg.totalDiscountMinorUnits,
      peakHours: agg.peakHours,
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

  /**
   * POS-094 — sales aggregated per employee for a store/day (read-only reporting).
   * Uses the pure, unit-tested aggregator.
   */
  async getSalesByEmployee(storeId: string, date: string) {
    const sales = await this.saleRepo
      .createQueryBuilder('s')
      .where('s.store_id = :storeId', { storeId })
      .andWhere('DATE(s.created_at) = :date', { date })
      .andWhere('s.status = :status', { status: 'completed' })
      .getMany();
    return aggregateSalesByEmployee(sales as any);
  }

  /**
   * POS-100 — local accounting export derived from the FROZEN Z-report (comptable).
   * Requires the Z-report to exist for the date. `format: 'csv'` returns a CSV string.
   * Sending to Comptamax24 is NOT implemented (external — see POS_INTEGRATIONS).
   */
  async getAccountingExport(
    storeId: string,
    date: string,
    format: 'json' | 'csv' = 'json',
  ) {
    const z = await this.zReportRepo.findOne({ where: { storeId, date } });
    if (!z) {
      throw new BadRequestException(
        'Aucun Z-report pour cette date — générez-le avant l’export comptable.',
      );
    }
    const row = buildDailyAccountingExport({
      date,
      storeId,
      totalRevenueMinorUnits: z.totalRevenueMinorUnits,
      totalTaxMinorUnits: z.totalTaxMinorUnits,
      cashTotalMinorUnits: z.cashTotalMinorUnits,
      cardTotalMinorUnits: z.cardTotalMinorUnits,
      discountTotalMinorUnits: z.discountTotalMinorUnits,
      transactionCount: z.transactionCount,
    });
    return format === 'csv' ? { csv: toAccountingCsv([row]) } : row;
  }

  /**
   * POS-102 — payments breakdown by method for a store/day (reconciliation / pre-accounting).
   */
  async getPaymentsBreakdown(storeId: string, date: string) {
    const sales = await this.saleRepo
      .createQueryBuilder('s')
      .leftJoinAndSelect('s.payments', 'p')
      .where('s.store_id = :storeId', { storeId })
      .andWhere('DATE(s.created_at) = :date', { date })
      .andWhere('s.status = :status', { status: 'completed' })
      .getMany();
    return aggregatePaymentsByMethod(sales as any);
  }
}
