import { Injectable } from '@nestjs/common';
import { SaleGuardsConfig } from './sales-guards.types';

/**
 * Loads sale-guard thresholds from env (never hardcoded in the engine).
 * Sensible defaults are applied when a var is unset.
 */
@Injectable()
export class SalesGuardsConfigProvider {
  private readonly config: SaleGuardsConfig;

  constructor() {
    const num = (v: string | undefined, def: number): number => {
      const n = v !== undefined ? Number(v) : NaN;
      return Number.isFinite(n) ? n : def;
    };

    this.config = {
      enabled: process.env.SALES_GUARDS_ENABLED !== 'false', // default ON
      lowMarginThresholdPct: num(process.env.SALES_GUARDS_LOW_MARGIN_PCT, 20),
      excessiveDiscountThresholdPct: num(process.env.SALES_GUARDS_EXCESSIVE_DISCOUNT_PCT, 20),
      manualPriceDeviationWarnPct: num(process.env.SALES_GUARDS_MANUAL_PRICE_WARN_PCT, 5),
      manualPriceDeviationBlockPct: num(process.env.SALES_GUARDS_MANUAL_PRICE_BLOCK_PCT, 20),
      freeProductDailyThreshold: num(process.env.SALES_GUARDS_FREE_PRODUCT_DAILY_THRESHOLD, 10),
      cancellationThreshold: num(process.env.SALES_GUARDS_CANCELLATION_THRESHOLD, 5),
    };
  }

  get(): SaleGuardsConfig {
    return this.config;
  }
}
