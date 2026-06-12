import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AnalyticsStoreSessionsEntity } from '../../../database/entities/analytics-store-sessions.entity';
import { AlertFact, AlertRule, AlertRuleContext } from '../alert-rule.interface';

/**
 * store_closed_late — POS sessions still OPEN past the store's configured closing
 * hour. Source (INV-4): analytics.store_sessions open_sessions (the sessions
 * projection); the closing hour is DATA (param close_hour_utc, store-overridable).
 *
 * Timezone caveat (noted, consistent with the étage-0 UTC business-day convention):
 * the hour is compared in UTC; the seeded default (21h UTC ≈ 22h/23h Paris) is a
 * starting point — per-store overrides carry the local reality. A real store-TZ
 * policy is an owner decision tracked with the business-day definition.
 */
@Injectable()
export class StoreClosedLateRule implements AlertRule {
  readonly name = 'store_closed_late';

  constructor(
    @InjectRepository(AnalyticsStoreSessionsEntity)
    private readonly sessions: Repository<AnalyticsStoreSessionsEntity>,
  ) {}

  async evaluate({ storeId, businessDay, now, params }: AlertRuleContext): Promise<AlertFact[]> {
    if (!params) return [];
    const closeHourUtc = Number(params.close_hour_utc ?? NaN);
    if (Number.isNaN(closeHourUtc)) return [];
    if (now.getUTCHours() < closeHourUtc) return []; // store still legitimately open

    const s = await this.sessions.findOne({ where: { storeId } });
    if (!s || s.openSessions === 0) return []; // properly closed → silent

    return [
      {
        rule: this.name,
        thresholdBand: 'open_after_close',
        businessDay,
        payload: {
          openSessions: s.openSessions,
          activeTerminals: s.activeTerminals,
          closeHourUtc,
          observedHourUtc: now.getUTCHours(),
        },
      },
    ];
  }
}
