import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AnalyticsStoreStockEntity } from '../../../database/entities/analytics-store-stock.entity';
import { AlertFact, AlertRule, AlertRuleContext } from '../alert-rule.interface';

/**
 * stock_low — the store's stock snapshot crosses a band.
 * Source (INV-4): analytics.store_stock rupture_count / low_stock_count — counts the
 * stock projection already derived from stock_balances; nothing recomputed here.
 * Bands: 'rupture' (any product at/under critical) fires unconditionally;
 * 'low_stock' fires when low_stock_count ≥ low_count_min (param, data).
 */
@Injectable()
export class StockLowRule implements AlertRule {
  readonly name = 'stock_low';

  constructor(
    @InjectRepository(AnalyticsStoreStockEntity)
    private readonly stock: Repository<AnalyticsStoreStockEntity>,
  ) {}

  async evaluate({ storeId, businessDay, params }: AlertRuleContext): Promise<AlertFact[]> {
    if (!params) return [];
    const s = await this.stock.findOne({ where: { storeId } });
    if (!s) return [];

    const facts: AlertFact[] = [];
    const payload = { ruptureCount: s.ruptureCount, lowStockCount: s.lowStockCount };

    if (s.ruptureCount > 0) {
      facts.push({ rule: this.name, thresholdBand: 'rupture', businessDay, payload });
    }
    const lowMin = Number(params.low_count_min ?? NaN);
    if (!Number.isNaN(lowMin) && s.lowStockCount >= lowMin) {
      facts.push({ rule: this.name, thresholdBand: 'low_stock', businessDay, payload: { ...payload, threshold: lowMin } });
    }
    return facts;
  }
}
