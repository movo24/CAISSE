import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AnalyticsStoreDailyEntity } from '../../../database/entities/analytics-store-daily.entity';
import { AlertFact, AlertRule, AlertRuleContext } from '../alert-rule.interface';

/**
 * void_rate — the day's void share crosses a configured band.
 * Source (INV-4): analytics.store_daily void_count / tx_count — figures the POS
 * already owns; nothing recomputed. rate = voids / (tx + voids).
 * Params (data): warning_rate, critical_rate, min_tx (noise floor: below this many
 * movements the rate is statistically meaningless). Bands emitted independently
 * ('warning', 'critical') — the dedup key makes each fire once; an escalation later
 * in the day produces the next band, not a duplicate.
 */
@Injectable()
export class VoidRateRule implements AlertRule {
  readonly name = 'void_rate';

  constructor(
    @InjectRepository(AnalyticsStoreDailyEntity)
    private readonly daily: Repository<AnalyticsStoreDailyEntity>,
  ) {}

  async evaluate({ storeId, businessDay, params }: AlertRuleContext): Promise<AlertFact[]> {
    if (!params) return []; // no config = no built-in threshold — skip
    const d = await this.daily.findOne({ where: { storeId, businessDay } });
    if (!d) return [];

    const movements = d.txCount + d.voidCount;
    const minTx = Number(params.min_tx ?? 0);
    if (movements === 0 || movements < minTx) return [];

    const rate = d.voidCount / movements;
    const payload = {
      rate: Math.round(rate * 1000) / 1000,
      voidCount: d.voidCount,
      txCount: d.txCount,
      voidAmountMinor: d.voidAmountMinor,
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
