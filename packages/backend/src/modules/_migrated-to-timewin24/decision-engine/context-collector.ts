// ── decision-engine/context-collector.ts ────────────────────────
// Collects all context data from external modules
// Weather + Transport + Footfall + Sales + Stock → DecisionContext
// ─────────────────────────────────────────────────────────────────

import { Injectable, Logger, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, MoreThan, In } from 'typeorm';
import { SaleEntity } from '../../database/entities/sale.entity';
import { ProductEntity } from '../../database/entities/product.entity';
import { EmployeeEntity } from '../../database/entities/employee.entity';
import { PointageEntryEntity } from '../../database/entities/pointage-entry.entity';
import { WeatherService } from '../weather/weather.service';
import { TransportService } from '../transport/transport.service';
import { FootfallService } from '../footfall/footfall.service';
import {
  DecisionContext,
  WeatherConditionTag,
  EmployeeActivity,
} from './decision-engine.types';

@Injectable()
export class ContextCollector {
  private readonly logger = new Logger('DecisionEngine:ContextCollector');

  constructor(
    @InjectRepository(SaleEntity)
    private readonly saleRepo: Repository<SaleEntity>,
    @InjectRepository(ProductEntity)
    private readonly productRepo: Repository<ProductEntity>,
    @InjectRepository(EmployeeEntity)
    private readonly employeeRepo: Repository<EmployeeEntity>,
    @InjectRepository(PointageEntryEntity)
    private readonly pointageRepo: Repository<PointageEntryEntity>,
    @Optional() private readonly weatherService?: WeatherService,
    @Optional() private readonly transportService?: TransportService,
    @Optional() private readonly footfallService?: FootfallService,
  ) {}

  /**
   * Collect all context data for a store.
   * Each source is independently fault-tolerant.
   */
  async collect(storeId: string): Promise<DecisionContext> {
    const now = new Date();

    // Run all collectors in parallel for speed
    const [weather, transport, footfall, sales, stock, employees] =
      await Promise.all([
        this.collectWeather(storeId),
        this.collectTransport(storeId),
        this.collectFootfall(storeId),
        this.collectSales(storeId, now),
        this.collectStock(storeId),
        this.collectEmployees(storeId, now),
      ]);

    const hour = now.getHours();
    const dayOfWeek = now.getDay();

    return {
      storeId,
      timestamp: now.toISOString(),
      weather,
      transport,
      footfall,
      sales,
      time: {
        hour,
        dayOfWeek,
        isWeekend: dayOfWeek === 0 || dayOfWeek === 6,
        isPeakHour:
          (hour >= 11 && hour <= 14) || (hour >= 17 && hour <= 20),
      },
      stock,
      employees,
    };
  }

  // ═══════════════════════════════════════════════════════════════
  //  WEATHER
  // ═══════════════════════════════════════════════════════════════

  private async collectWeather(
    storeId: string,
  ): Promise<DecisionContext['weather']> {
    if (!this.weatherService) {
      return { available: false };
    }

    try {
      const w = await this.weatherService.getWeather(storeId);
      if (!w) return { available: false };

      return {
        available: true,
        temp: w.current.temp,
        feelsLike: w.current.feelsLike,
        condition: w.current.businessCategory as WeatherConditionTag,
        isRaining: w.current.isRaining,
        rainIntensity: w.current.rainIntensity,
        windSpeed: w.current.windSpeed,
      };
    } catch (err: any) {
      this.logger.debug(`Weather collect failed: ${err.message}`);
      return { available: false };
    }
  }

  // ═══════════════════════════════════════════════════════════════
  //  TRANSPORT
  // ═══════════════════════════════════════════════════════════════

  private async collectTransport(
    storeId: string,
  ): Promise<DecisionContext['transport']> {
    if (!this.transportService) {
      return { available: false };
    }

    try {
      const ctx = await this.transportService.getTransportContext(storeId);
      if (!ctx) return { available: false };

      const hasStrike = ctx.disruptions.some(
        (d) => d.type === 'greve',
      );

      return {
        available: true,
        status: ctx.traffic_status,
        activeDisruptions: ctx.activeDisruptionCount,
        hasStrike,
      };
    } catch (err: any) {
      this.logger.debug(`Transport collect failed: ${err.message}`);
      return { available: false };
    }
  }

  // ═══════════════════════════════════════════════════════════════
  //  FOOTFALL
  // ═══════════════════════════════════════════════════════════════

  private async collectFootfall(
    storeId: string,
  ): Promise<DecisionContext['footfall']> {
    if (!this.footfallService) {
      return { available: false };
    }

    try {
      const ctx = await this.footfallService.getFootfallContext(storeId);
      if (!ctx) return { available: false };

      return {
        available: true,
        score: ctx.footfallScore,
        level: ctx.nearbyTrafficLevel,
        totalNearbyPlaces: ctx.totalNearbyPlaces,
      };
    } catch (err: any) {
      this.logger.debug(`Footfall collect failed: ${err.message}`);
      return { available: false };
    }
  }

  // ═══════════════════════════════════════════════════════════════
  //  SALES (query DB directly for real-time data)
  // ═══════════════════════════════════════════════════════════════

  private async collectSales(
    storeId: string,
    now: Date,
  ): Promise<DecisionContext['sales']> {
    try {
      const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
      const threeHoursAgo = new Date(now.getTime() - 3 * 60 * 60 * 1000);
      const startOfDay = new Date(now);
      startOfDay.setHours(0, 0, 0, 0);

      // Last hour sales
      const lastHourSales = await this.saleRepo.find({
        where: {
          storeId,
          status: 'completed',
          completedAt: MoreThan(oneHourAgo),
        },
        relations: ['lineItems'],
      });

      const lastHourCount = lastHourSales.length;
      const lastHourRevenue = lastHourSales.reduce(
        (sum, s) => sum + s.totalMinorUnits,
        0,
      );

      // Top selling products in last hour
      const productSales = new Map<string, number>();
      for (const sale of lastHourSales) {
        for (const item of sale.lineItems || []) {
          productSales.set(
            item.productId,
            (productSales.get(item.productId) || 0) + item.quantity,
          );
        }
      }
      const topSellingProductIds = [...productSales.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([id]) => id);

      // Today sales (count + revenue)
      const todaySales = await this.saleRepo.find({
        where: {
          storeId,
          status: 'completed',
          completedAt: MoreThan(startOfDay),
        },
        select: ['id', 'totalMinorUnits'],
      });

      const todayCount = todaySales.length;
      const todayRevenue = todaySales.reduce(
        (sum, s) => sum + s.totalMinorUnits,
        0,
      );

      // Slow moving: products sold in last 3h vs all active products
      const threeHourSales = await this.saleRepo.find({
        where: {
          storeId,
          status: 'completed',
          completedAt: MoreThan(threeHoursAgo),
        },
        relations: ['lineItems'],
      });

      const soldProductIds = new Set<string>();
      for (const sale of threeHourSales) {
        for (const item of sale.lineItems || []) {
          soldProductIds.add(item.productId);
        }
      }

      // Get active products that haven't sold
      const activeProducts = await this.productRepo.find({
        where: { storeId, isActive: true },
        select: ['id'],
        take: 200,
      });

      const slowMovingProductIds = activeProducts
        .filter((p) => !soldProductIds.has(p.id))
        .slice(0, 20)
        .map((p) => p.id);

      return {
        available: true,
        lastHourCount,
        lastHourRevenue,
        todayCount,
        todayRevenue,
        topSellingProductIds,
        slowMovingProductIds,
      };
    } catch (err: any) {
      this.logger.debug(`Sales collect failed: ${err.message}`);
      return { available: false };
    }
  }

  // ═══════════════════════════════════════════════════════════════
  //  STOCK
  // ═══════════════════════════════════════════════════════════════

  private async collectStock(
    storeId: string,
  ): Promise<DecisionContext['stock']> {
    try {
      const products = await this.productRepo.find({
        where: { storeId, isActive: true },
        select: [
          'id',
          'stockQuantity',
          'stockAlertThreshold',
          'stockCriticalThreshold',
        ],
      });

      let alertCount = 0;
      let criticalCount = 0;
      let outOfStockCount = 0;

      for (const p of products) {
        if (p.stockQuantity <= 0) {
          outOfStockCount++;
        } else if (p.stockQuantity <= p.stockCriticalThreshold) {
          criticalCount++;
        } else if (p.stockQuantity <= p.stockAlertThreshold) {
          alertCount++;
        }
      }

      return {
        available: true,
        alertCount,
        criticalCount,
        outOfStockCount,
      };
    } catch (err: any) {
      this.logger.debug(`Stock collect failed: ${err.message}`);
      return { available: false };
    }
  }

  // ═══════════════════════════════════════════════════════════════
  //  EMPLOYEES (fraud / theft detection)
  // ═══════════════════════════════════════════════════════════════

  private async collectEmployees(
    storeId: string,
    now: Date,
  ): Promise<DecisionContext['employees']> {
    try {
      const startOfDay = new Date(now);
      startOfDay.setHours(0, 0, 0, 0);

      // Get all employees for this store
      const employees = await this.employeeRepo.find({
        where: { storeId, isActive: true },
        select: ['id', 'firstName', 'lastName', 'role'],
      });

      if (employees.length === 0) {
        return { available: false };
      }

      const employeeIds = employees.map((e) => e.id);

      // Get all today's sales (completed + voided) for these employees
      const todaySales = await this.saleRepo.find({
        where: {
          storeId,
          createdAt: MoreThan(startOfDay),
        },
        relations: ['lineItems'],
        select: [
          'id',
          'employeeId',
          'status',
          'totalMinorUnits',
          'subtotalMinorUnits',
          'discountTotalMinorUnits',
          'completedAt',
          'createdAt',
        ],
      });

      // Get today's pointage entries
      const todayPointages = await this.pointageRepo.find({
        where: {
          storeId,
          timestamp: MoreThan(startOfDay),
        },
      });

      // Determine who is currently clocked in
      const clockedInSet = new Set<string>();
      const pointageByEmployee = new Map<string, typeof todayPointages>();
      for (const p of todayPointages) {
        if (!pointageByEmployee.has(p.employeeId)) {
          pointageByEmployee.set(p.employeeId, []);
        }
        pointageByEmployee.get(p.employeeId)!.push(p);
      }

      for (const [empId, entries] of pointageByEmployee) {
        // Sort by timestamp
        entries.sort(
          (a, b) =>
            new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
        );
        const lastEntry = entries[entries.length - 1];
        if (lastEntry && lastEntry.type === 'clock_in') {
          clockedInSet.add(empId);
        }
      }

      // Employees with pointage anomalies
      const anomalyEmployeeIds: string[] = [];
      for (const [empId, entries] of pointageByEmployee) {
        const types = entries.map((e) => e.type);
        // Missing clock_out
        if (
          types.filter((t) => t === 'clock_in').length >
          types.filter((t) => t === 'clock_out').length
        ) {
          // Only flag if more than 10h since last clock_in
          const lastClockIn = entries
            .filter((e) => e.type === 'clock_in')
            .pop();
          if (
            lastClockIn &&
            now.getTime() - new Date(lastClockIn.timestamp).getTime() >
              10 * 60 * 60 * 1000
          ) {
            anomalyEmployeeIds.push(empId);
          }
        }
      }

      // Build per-employee activity
      let totalVoidsToday = 0;
      let totalDiscountsToday = 0;
      let totalSalesToday = 0;
      let totalRevenueToday = 0;

      const activity: EmployeeActivity[] = [];

      for (const emp of employees) {
        const empSales = todaySales.filter(
          (s) => s.employeeId === emp.id,
        );
        const completedSales = empSales.filter(
          (s) => s.status === 'completed',
        );
        const voidedSales = empSales.filter(
          (s) => s.status === 'voided',
        );

        const salesCount = completedSales.length;
        const voidCount = voidedSales.length;
        const revenueTotal = completedSales.reduce(
          (sum, s) => sum + s.totalMinorUnits,
          0,
        );
        const discountTotal = completedSales.reduce(
          (sum, s) => sum + s.discountTotalMinorUnits,
          0,
        );
        const subtotalTotal = completedSales.reduce(
          (sum, s) => sum + s.subtotalMinorUnits,
          0,
        );

        totalVoidsToday += voidCount;
        totalDiscountsToday += discountTotal;
        totalSalesToday += salesCount;
        totalRevenueToday += revenueTotal;

        // Void rate
        const totalTx = salesCount + voidCount;
        const voidRate = totalTx > 0 ? voidCount / totalTx : 0;

        // Average discount %
        const avgDiscountPercent =
          subtotalTotal > 0
            ? (discountTotal / subtotalTotal) * 100
            : 0;

        // Average sale amount
        const avgSaleAmount =
          salesCount > 0 ? Math.round(revenueTotal / salesCount) : 0;

        // Time since last sale
        let minutesSinceLastSale: number | null = null;
        if (completedSales.length > 0) {
          const lastSale = completedSales
            .filter((s) => s.completedAt)
            .sort(
              (a, b) =>
                new Date(b.completedAt!).getTime() -
                new Date(a.completedAt!).getTime(),
            )[0];
          if (lastSale?.completedAt) {
            minutesSinceLastSale = Math.round(
              (now.getTime() - new Date(lastSale.completedAt).getTime()) /
                60000,
            );
          }
        }

        const isClockedIn = clockedInSet.has(emp.id);

        // Selling off-clock: has sales today but not currently clocked in
        const isSellingOffClock =
          salesCount > 0 && !isClockedIn && !pointageByEmployee.has(emp.id);

        activity.push({
          employeeId: emp.id,
          employeeName: `${emp.firstName} ${emp.lastName}`,
          role: emp.role,
          salesCount,
          revenueTotal,
          voidCount,
          voidRate: Math.round(voidRate * 100) / 100,
          discountTotal,
          avgDiscountPercent: Math.round(avgDiscountPercent * 10) / 10,
          noSaleCount: 0, // Not tracked yet
          avgSaleAmount,
          minutesSinceLastSale,
          isClockedIn,
          isSellingOffClock,
        });
      }

      const avgDiscountRateToday =
        totalRevenueToday > 0
          ? (totalDiscountsToday /
              (totalRevenueToday + totalDiscountsToday)) *
            100
          : 0;

      return {
        available: true,
        activity,
        totalVoidsToday,
        totalDiscountsToday,
        avgDiscountRateToday:
          Math.round(avgDiscountRateToday * 10) / 10,
        clockedInCount: clockedInSet.size,
        anomalyEmployeeIds,
      };
    } catch (err: any) {
      this.logger.debug(`Employees collect failed: ${err.message}`);
      return { available: false };
    }
  }
}
