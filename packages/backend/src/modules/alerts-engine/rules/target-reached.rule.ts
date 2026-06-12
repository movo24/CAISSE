import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AnalyticsStoreDailyEntity } from '../../../database/entities/analytics-store-daily.entity';
import { AnalyticsStoreTargetEntity } from '../../../database/entities/analytics-store-target.entity';
import { AlertFact, AlertRule, AlertRuleContext } from '../alert-rule.interface';

/**
 * target_reached — the day's revenue reached the store's daily objective.
 * Sources (INV-4): analytics.store_daily (ca_brut, the realized figure) and
 * analytics.store_targets — the SHARED objective datum (one source, two readers:
 * this rule and the overview %atteint; structural decision, never two copies).
 * NOT alert_config: the objective is a management input, not a rule parameter.
 * No datum = no objective → silent (INV-3: nothing fabricated). Fires once per
 * (store, day) via the INV-6 key, band 'reached'.
 */
@Injectable()
export class TargetReachedRule implements AlertRule {
  readonly name = 'target_reached';

  constructor(
    @InjectRepository(AnalyticsStoreDailyEntity)
    private readonly daily: Repository<AnalyticsStoreDailyEntity>,
    @InjectRepository(AnalyticsStoreTargetEntity)
    private readonly targets: Repository<AnalyticsStoreTargetEntity>,
  ) {}

  async evaluate({ storeId, businessDay }: AlertRuleContext): Promise<AlertFact[]> {
    const target = await this.targets.findOne({ where: { storeId } });
    if (!target || !target.isActive || target.dailyTargetMinor <= 0) return [];

    const d = await this.daily.findOne({ where: { storeId, businessDay } });
    if (!d) return [];
    if (d.caBrutMinor < target.dailyTargetMinor) return [];

    return [
      {
        rule: this.name,
        thresholdBand: 'reached',
        businessDay,
        payload: {
          caBrutMinor: d.caBrutMinor,
          targetMinor: target.dailyTargetMinor,
          reachedPct: Math.round((d.caBrutMinor / target.dailyTargetMinor) * 1000) / 10,
        },
      },
    ];
  }
}
