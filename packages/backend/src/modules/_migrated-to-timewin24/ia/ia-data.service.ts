import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, MoreThanOrEqual } from 'typeorm';
import { SaleEntity } from '../../database/entities/sale.entity';
import { SaleLineItemEntity } from '../../database/entities/sale-line-item.entity';
import { ProductEntity } from '../../database/entities/product.entity';
import { EmployeeEntity } from '../../database/entities/employee.entity';
import { ZReportEntity } from '../../database/entities/z-report.entity';
import { StoreEntity } from '../../database/entities/store.entity';

/**
 * Contexte magasin agrégé pour le system prompt Claude.
 * Données limités aux 7 derniers jours pour contrôler la taille du contexte.
 */
export interface StoreDataContext {
  storeName: string;
  totalRevenueMinorUnits: number;
  transactionCount: number;
  averageBasketMinorUnits: number;
  topProducts: { name: string; quantity: number; revenueMinorUnits: number }[];
  stockAlerts: { name: string; stock: number; threshold: number }[];
  employeeCount: number;
  employeesByRole: Record<string, number>;
  zReports: {
    date: string;
    revenueMinorUnits: number;
    transactions: number;
    cashMinorUnits: number;
    cardMinorUnits: number;
  }[];
}

/**
 * IaDataService – agrège les données de plusieurs sources
 * pour construire le contexte envoyé à Claude.
 *
 * Toutes les queries sont tenant-scoped (filtrées par storeId).
 */
@Injectable()
export class IaDataService {
  constructor(
    @InjectRepository(SaleEntity)
    private saleRepo: Repository<SaleEntity>,
    @InjectRepository(SaleLineItemEntity)
    private lineItemRepo: Repository<SaleLineItemEntity>,
    @InjectRepository(ProductEntity)
    private productRepo: Repository<ProductEntity>,
    @InjectRepository(EmployeeEntity)
    private employeeRepo: Repository<EmployeeEntity>,
    @InjectRepository(ZReportEntity)
    private zReportRepo: Repository<ZReportEntity>,
    @InjectRepository(StoreEntity)
    private storeRepo: Repository<StoreEntity>,
  ) {}

  /**
   * Construit le contexte complet du magasin (7 derniers jours).
   */
  async buildStoreContext(storeId: string): Promise<StoreDataContext> {
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    // Requêtes parallèles pour la performance
    const [store, salesData, topProducts, stockAlerts, employees, zReports] =
      await Promise.all([
        this.storeRepo.findOne({ where: { id: storeId } }),
        this.getSalesAggregates(storeId, sevenDaysAgo),
        this.getTopProducts(storeId, sevenDaysAgo),
        this.getStockAlerts(storeId),
        this.getEmployeeStats(storeId),
        this.getRecentZReports(storeId),
      ]);

    return {
      storeName: store?.name || 'Magasin',
      totalRevenueMinorUnits: salesData.totalRevenue,
      transactionCount: salesData.count,
      averageBasketMinorUnits:
        salesData.count > 0
          ? Math.round(salesData.totalRevenue / salesData.count)
          : 0,
      topProducts,
      stockAlerts,
      employeeCount: employees.total,
      employeesByRole: employees.byRole,
      zReports,
    };
  }

  /** Données pour un rapport journalier */
  async getDailySummaryData(storeId: string, date: string): Promise<any> {
    const sales = await this.saleRepo
      .createQueryBuilder('s')
      .leftJoinAndSelect('s.lineItems', 'li')
      .leftJoinAndSelect('s.payments', 'p')
      .where('s.store_id = :storeId', { storeId })
      .andWhere('DATE(s.created_at) = :date', { date })
      .andWhere('s.status = :status', { status: 'completed' })
      .getMany();

    const voidCount = await this.saleRepo
      .createQueryBuilder('s')
      .where('s.store_id = :storeId', { storeId })
      .andWhere('DATE(s.created_at) = :date', { date })
      .andWhere('s.status = :status', { status: 'voided' })
      .getCount();

    let totalRevenue = 0;
    let totalDiscount = 0;
    let cashTotal = 0;
    let cardTotal = 0;
    const productSales: Record<string, { name: string; qty: number; revenue: number }> = {};
    const hourCounts: Record<number, number> = {};

    for (const sale of sales) {
      totalRevenue += sale.totalMinorUnits;
      totalDiscount += sale.discountTotalMinorUnits;
      for (const p of sale.payments) {
        if (p.method === 'cash') cashTotal += p.amountMinorUnits;
        else cardTotal += p.amountMinorUnits;
      }
      for (const li of sale.lineItems) {
        if (!productSales[li.productId]) {
          productSales[li.productId] = { name: li.productName, qty: 0, revenue: 0 };
        }
        productSales[li.productId].qty += li.quantity;
        productSales[li.productId].revenue += li.lineTotalMinorUnits;
      }
      const hour = new Date(sale.createdAt).getHours();
      hourCounts[hour] = (hourCounts[hour] || 0) + 1;
    }

    const topProducts = Object.values(productSales)
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 10);

    return {
      date,
      totalRevenueMinorUnits: totalRevenue,
      transactionCount: sales.length,
      averageBasketMinorUnits: sales.length > 0 ? Math.round(totalRevenue / sales.length) : 0,
      cashTotalMinorUnits: cashTotal,
      cardTotalMinorUnits: cardTotal,
      discountTotalMinorUnits: totalDiscount,
      voidCount,
      topProducts,
      peakHours: Object.entries(hourCounts)
        .map(([h, c]) => ({ hour: parseInt(h), count: c }))
        .sort((a, b) => b.count - a.count),
    };
  }

  /** Données pour une analyse hebdomadaire */
  async getWeeklyData(storeId: string): Promise<any> {
    const zReports = await this.getRecentZReports(storeId);
    const context = await this.buildStoreContext(storeId);
    return { ...context, zReports };
  }

  /** Données pour l'analyse produits */
  async getProductData(storeId: string): Promise<any> {
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const products = await this.productRepo.find({
      where: { storeId, isActive: true },
    });

    const topProducts = await this.getTopProducts(storeId, sevenDaysAgo, 20);
    const stockAlerts = await this.getStockAlerts(storeId);

    // Produits dormants (pas vendus en 7j)
    const soldProductIds = new Set(topProducts.map((p) => p.name));
    const dormantProducts = products
      .filter((p) => !soldProductIds.has(p.name))
      .map((p) => ({
        name: p.name,
        stock: p.stockQuantity,
        priceMinorUnits: p.priceMinorUnits,
      }))
      .slice(0, 10);

    return {
      totalProducts: products.length,
      topProducts,
      stockAlerts,
      dormantProducts,
    };
  }

  /** Données pour l'analyse caissiers */
  async getCashierData(storeId: string): Promise<any> {
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const employees = await this.employeeRepo.find({
      where: { storeId, isActive: true },
    });

    // Ventes par employé
    const salesByEmployee = await this.saleRepo
      .createQueryBuilder('s')
      .select('s.employee_id', 'employeeId')
      .addSelect('COUNT(*)', 'ticketCount')
      .addSelect('SUM(s.total_minor_units)', 'totalRevenue')
      .addSelect('AVG(s.total_minor_units)', 'avgBasket')
      .where('s.store_id = :storeId', { storeId })
      .andWhere('s.status = :status', { status: 'completed' })
      .andWhere('s.created_at >= :since', { since: sevenDaysAgo })
      .groupBy('s.employee_id')
      .getRawMany();

    // Annulations par employé
    const voidsByEmployee = await this.saleRepo
      .createQueryBuilder('s')
      .select('s.employee_id', 'employeeId')
      .addSelect('COUNT(*)', 'voidCount')
      .where('s.store_id = :storeId', { storeId })
      .andWhere('s.status = :status', { status: 'voided' })
      .andWhere('s.created_at >= :since', { since: sevenDaysAgo })
      .groupBy('s.employee_id')
      .getRawMany();

    const voidMap = new Map(voidsByEmployee.map((v) => [v.employeeId, parseInt(v.voidCount)]));

    const cashierStats = salesByEmployee.map((s) => {
      const emp = employees.find((e) => e.id === s.employeeId);
      return {
        name: emp ? `${emp.firstName} ${emp.lastName}` : 'Inconnu',
        role: emp?.role || 'cashier',
        ticketCount: parseInt(s.ticketCount),
        totalRevenueMinorUnits: parseInt(s.totalRevenue),
        avgBasketMinorUnits: Math.round(parseFloat(s.avgBasket)),
        voidCount: voidMap.get(s.employeeId) || 0,
      };
    });

    return {
      totalEmployees: employees.length,
      cashierStats: cashierStats.sort(
        (a, b) => b.totalRevenueMinorUnits - a.totalRevenueMinorUnits,
      ),
    };
  }

  // ── Méthodes privées ──────────────────────────────────────────────────

  private async getSalesAggregates(
    storeId: string,
    since: Date,
  ): Promise<{ totalRevenue: number; count: number }> {
    const result = await this.saleRepo
      .createQueryBuilder('s')
      .select('COALESCE(SUM(s.total_minor_units), 0)', 'totalRevenue')
      .addSelect('COUNT(*)', 'count')
      .where('s.store_id = :storeId', { storeId })
      .andWhere('s.status = :status', { status: 'completed' })
      .andWhere('s.created_at >= :since', { since })
      .getRawOne();

    return {
      totalRevenue: parseInt(result?.totalRevenue || '0'),
      count: parseInt(result?.count || '0'),
    };
  }

  private async getTopProducts(
    storeId: string,
    since: Date,
    limit = 10,
  ): Promise<{ name: string; quantity: number; revenueMinorUnits: number }[]> {
    const results = await this.lineItemRepo
      .createQueryBuilder('li')
      .select('li.product_name', 'name')
      .addSelect('SUM(li.quantity)', 'quantity')
      .addSelect('SUM(li.line_total_minor_units)', 'revenue')
      .innerJoin('li.sale', 's')
      .where('s.store_id = :storeId', { storeId })
      .andWhere('s.status = :status', { status: 'completed' })
      .andWhere('s.created_at >= :since', { since })
      .groupBy('li.product_name')
      .orderBy('revenue', 'DESC')
      .limit(limit)
      .getRawMany();

    return results.map((r) => ({
      name: r.name,
      quantity: parseInt(r.quantity),
      revenueMinorUnits: parseInt(r.revenue),
    }));
  }

  private async getStockAlerts(
    storeId: string,
  ): Promise<{ name: string; stock: number; threshold: number }[]> {
    const products = await this.productRepo
      .createQueryBuilder('p')
      .where('p.store_id = :storeId', { storeId })
      .andWhere('p.is_active = true')
      .andWhere('p.stock_quantity <= p.stock_alert_threshold')
      .orderBy('p.stock_quantity', 'ASC')
      .limit(10)
      .getMany();

    return products.map((p) => ({
      name: p.name,
      stock: p.stockQuantity,
      threshold: p.stockAlertThreshold,
    }));
  }

  private async getEmployeeStats(
    storeId: string,
  ): Promise<{ total: number; byRole: Record<string, number> }> {
    const employees = await this.employeeRepo.find({
      where: { storeId, isActive: true },
    });

    const byRole: Record<string, number> = {};
    for (const emp of employees) {
      byRole[emp.role] = (byRole[emp.role] || 0) + 1;
    }

    return { total: employees.length, byRole };
  }

  private async getRecentZReports(
    storeId: string,
    limit = 7,
  ): Promise<StoreDataContext['zReports']> {
    const reports = await this.zReportRepo
      .createQueryBuilder('z')
      .where('z.store_id = :storeId', { storeId })
      .orderBy('z.date', 'DESC')
      .limit(limit)
      .getMany();

    return reports.map((r) => ({
      date: r.date as unknown as string,
      revenueMinorUnits: r.totalRevenueMinorUnits,
      transactions: r.transactionCount,
      cashMinorUnits: r.cashTotalMinorUnits,
      cardMinorUnits: r.cardTotalMinorUnits,
    }));
  }
}
