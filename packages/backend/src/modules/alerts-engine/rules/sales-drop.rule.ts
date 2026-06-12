import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AnalyticsStoreDailyEntity } from '../../../database/entities/analytics-store-daily.entity';
import { AlertFact, AlertRule, AlertRuleContext } from '../alert-rule.interface';

/**
 * sales_drop — the LAST CLOSED day's net revenue dropped vs its own baseline.
 * Source (INV-4): analytics.store_daily history only (the projection accrues one
 * row per business day; closed-day rows are frozen by the refresh cycle).
 *
 * Semantics (implementation latitude, noted): the rule evaluates YESTERDAY (the
 * last closed UTC day), never the running day — comparing a partial day to full
 * days would fabricate drops, and the projection carries no intraday baseline.
 * Baseline = average net of the SAME WEEKDAY over the lookback window (a Tuesday
 * compares to Tuesdays). The fact's businessDay = the closed day that dropped; the
 * INV-6 key makes it fire exactly once.
 * Params (data): drop_pct, lookback_weeks, min_weeks (baseline confidence floor),
 * min_baseline_minor (noise floor — tiny baselines produce meaningless ratios).
 */
@Injectable()
export class SalesDropRule implements AlertRule {
  readonly name = 'sales_drop';

  constructor(
    @InjectRepository(AnalyticsStoreDailyEntity)
    private readonly daily: Repository<AnalyticsStoreDailyEntity>,
  ) {}

  async evaluate({ storeId, now, params }: AlertRuleContext): Promise<AlertFact[]> {
    if (!params) return [];
    const dropPct = Number(params.drop_pct ?? NaN);
    const lookbackWeeks = Number(params.lookback_weeks ?? 4);
    const minWeeks = Number(params.min_weeks ?? 2);
    const minBaseline = Number(params.min_baseline_minor ?? 0);
    if (Number.isNaN(dropPct)) return [];

    const closedDay = shiftDay(now, -1);
    const row = await this.daily.findOne({ where: { storeId, businessDay: closedDay } });
    if (!row) return []; // no data for the closed day → nothing to judge

    const history: number[] = [];
    for (let w = 1; w <= lookbackWeeks; w++) {
      const prior = await this.daily.findOne({ where: { storeId, businessDay: shiftDay(now, -1 - 7 * w) } });
      if (prior) history.push(prior.netMinor);
    }
    if (history.length < minWeeks) return []; // not enough same-weekday history (greenfield-safe)

    const baseline = Math.round(history.reduce((a, b) => a + b, 0) / history.length);
    if (baseline < minBaseline) return []; // noise floor

    const threshold = Math.round(baseline * (1 - dropPct));
    if (row.netMinor > threshold) return [];

    return [
      {
        rule: this.name,
        thresholdBand: 'drop',
        businessDay: closedDay,
        payload: {
          netMinor: row.netMinor,
          baselineMinor: baseline,
          baselineWeeks: history.length,
          dropPct,
          observedDropPct: Math.round((1 - row.netMinor / baseline) * 1000) / 1000,
        },
      },
    ];
  }
}

const shiftDay = (d: Date, delta: number): string => {
  const x = new Date(d);
  x.setUTCDate(x.getUTCDate() + delta);
  return x.toISOString().slice(0, 10);
};
