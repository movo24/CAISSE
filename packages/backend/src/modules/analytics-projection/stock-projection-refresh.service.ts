import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { StoreEntity } from '../../database/entities/store.entity';
import { StockLocationEntity } from '../../database/entities/stock-location.entity';
import { StockBalanceEntity } from '../../database/entities/stock-balance.entity';
import { AnalyticsStoreStockEntity } from '../../database/entities/analytics-store-stock.entity';

/**
 * INV-4 — stock is owned by Inventory; the canonical source is `stock_balances`
 * (per-location quantity + alert/critical thresholds), NOT the legacy
 * `products.stock_quantity` (frozen decision 1). This job derives rupture/low-stock
 * counts per store (location → store via stock_locations) into analytics_store_stock.
 * It consolidates, it does not recompute stock.
 */
@Injectable()
export class StockProjectionRefreshService {
  private readonly logger = new Logger(StockProjectionRefreshService.name);

  constructor(
    @InjectRepository(StoreEntity) private readonly stores: Repository<StoreEntity>,
    @InjectRepository(StockLocationEntity) private readonly locations: Repository<StockLocationEntity>,
    @InjectRepository(StockBalanceEntity) private readonly balances: Repository<StockBalanceEntity>,
    @InjectRepository(AnalyticsStoreStockEntity) private readonly projStock: Repository<AnalyticsStoreStockEntity>,
  ) {}

  @Cron('*/5 * * * *')
  async refresh(): Promise<void> {
    try {
      await this.refreshAll(new Date());
    } catch (e: any) {
      this.logger.warn(`Stock projection refresh failed: ${e?.message}`);
    }
  }

  async refreshAll(now: Date): Promise<void> {
    const stores = await this.stores.find({ where: { isActive: true } });
    for (const store of stores) {
      const locs = await this.locations.find({ where: { storeId: store.id }, select: ['id'] });
      const locIds = locs.map((l) => l.id);

      let rupture = 0;
      let low = 0;
      if (locIds.length > 0) {
        const bals = await this.balances
          .createQueryBuilder('b')
          .where('b.location_id IN (:...locs)', { locs: locIds })
          .getMany();
        for (const b of bals) {
          if (b.quantity <= b.criticalThreshold) rupture++;
          else if (b.quantity <= b.alertThreshold) low++;
        }
      }

      await this.projStock.delete({ storeId: store.id });
      await this.projStock.insert({
        storeId: store.id,
        ruptureCount: rupture,
        lowStockCount: low,
        computedAt: now,
      });
    }
  }
}
