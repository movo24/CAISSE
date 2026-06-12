import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AnalyticsStoreDailyEntity } from '../../../database/entities/analytics-store-daily.entity';
import { AlertFact, AlertRule, AlertRuleContext } from '../alert-rule.interface';

/**
 * discount_rate — the day's granted-discount share crosses a configured band.
 * Source (INV-4): analytics.store_daily discount_total_minor / ca_brut_minor — the
 * raw figures the projection derives; the rule only computes the ratio.
 * Definition: ca_brut is POST-discount (sale totals), so the pre-discount gross is
 * caBrut + discount → rate = discount / (caBrut + discount). Symmetric with
 * void_rate (voids / (tx + voids)).
 * Params (data): warning_rate, critical_rate, min_tx (noise floor).
 */
@Injectable()
export class DiscountRateRule implements AlertRule {
  readonly name = 'discount_rate';

  constructor(
    @InjectRepository(AnalyticsStoreDailyEntity)
    private readonly daily: Repository<AnalyticsStoreDailyEntity>,
  ) {}

  async evaluate({ storeId, businessDay, params }: AlertRuleContext): Promise<AlertFact[]> {
    if (!params) return [];
    const d = await this.daily.findOne({ where: { storeId, businessDay } });
    if (!d) return [];

    const minTx = Number(params.min_tx ?? 0);
    if (d.txCount === 0 || d.txCount < minTx) return [];

    const gross = d.caBrutMinor + d.discountTotalMinor;
    if (gross <= 0) return [];
    const rate = d.discountTotalMinor / gross;

    const payload = {
      rate: Math.round(rate * 1000) / 1000,
      discountTotalMinor: d.discountTotalMinor,
      caBrutMinor: d.caBrutMinor,
      txCount: d.txCount,
    };

    const facts: AlertFact[] = [];
    const warning = Number(params.warning_rate ?? NaN);
    const critical = Number(params.critical_rate ?? NaN);
    if (!Number.isNaN(critical) && rate >= critical) {
      facts.push({ rule: this.name, thresholdBand: 'critical', businessDay, payload: { ...payload, threshold: critical } });
    }
    if (!Number.isNaN(warning) && rate >= warning) {
      facts.push({ rule: this.name, thresholdBand: 'warning', businessDay, payload: { ...payload, threshold: warning } });
    }
    return facts;
  }
}
