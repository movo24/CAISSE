import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { AnalyticsStoreSessionsEntity } from '../../../database/entities/analytics-store-sessions.entity';
import { AnalyticsStoreClockEntity } from '../../../database/entities/analytics-store-clock.entity';
import { localHourOf } from '../../../common/clock/wall-clock.util';
import { AlertFact, AlertRule, AlertRuleContext } from '../alert-rule.interface';

/**
 * store_closed_late — POS sessions still OPEN past the store's closing hour.
 * Source (INV-4): analytics.store_sessions open_sessions (the sessions projection).
 *
 * The closing hour comes from analytics.store_clock — the SINGLE wall-clock datum
 * shared with the ai-brief beats and the business-day definition (ratified:
 * never a "beats TZ" separate from an "alerts TZ"). A1 ratified: the hour is
 * evaluated in the row's IANA timezone (LOCAL wall-clock, DST-correct) — the UTC
 * stand-in is gone, which is what dissolved D-ALERTS-1. Per-store override else
 * network default; no clock row → silent (no invented closing hour).
 */
@Injectable()
export class StoreClosedLateRule implements AlertRule {
  readonly name = 'store_closed_late';

  constructor(
    @InjectRepository(AnalyticsStoreSessionsEntity)
    private readonly sessions: Repository<AnalyticsStoreSessionsEntity>,
    @InjectRepository(AnalyticsStoreClockEntity)
    private readonly clock: Repository<AnalyticsStoreClockEntity>,
  ) {}

  async evaluate({ storeId, businessDay, now }: AlertRuleContext): Promise<AlertFact[]> {
    const clock =
      (await this.clock.findOne({ where: { storeId, isActive: true } })) ??
      (await this.clock.findOne({ where: { storeId: IsNull(), isActive: true } }));
    if (!clock) return []; // no clock datum → no invented closing hour

    // A1: LOCAL wall-clock in the datum's IANA timezone (DST-correct).
    const observedLocalHour = localHourOf(now, clock.timezone);
    if (observedLocalHour < clock.closeHour) return []; // store still legitimately open

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
          closeHour: clock.closeHour,
          clockTimezone: clock.timezone,
          observedLocalHour,
        },
      },
    ];
  }
}
