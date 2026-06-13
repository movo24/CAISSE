import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { AnalyticsStoreSessionsEntity } from '../../../database/entities/analytics-store-sessions.entity';
import { AnalyticsStoreClockEntity } from '../../../database/entities/analytics-store-clock.entity';
import { AlertFact, AlertRule, AlertRuleContext } from '../alert-rule.interface';

/**
 * store_closed_late — POS sessions still OPEN past the store's closing hour.
 * Source (INV-4): analytics.store_sessions open_sessions (the sessions projection).
 *
 * The closing hour comes from analytics.store_clock — the SINGLE wall-clock datum
 * shared with the ai-brief beats and the (future) business-day definition
 * (ratified: never a "beats TZ" separate from an "alerts TZ"). Per-store override
 * else network default; no clock row → silent (no invented closing hour).
 *
 * D-ALERTS-1 still applies: the clock's timezone is the UTC STAND-IN today, so
 * the hour comparison is UTC wall-clock — generation is fine (greenfield-inert),
 * but étage 4 must NOT deliver this rule until the real store-TZ policy lands.
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

    // UTC stand-in: hours are read as UTC until the store-TZ policy lands (D-ALERTS-1).
    if (now.getUTCHours() < clock.closeHour) return []; // store still legitimately open

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
          observedHourUtc: now.getUTCHours(),
        },
      },
    ];
  }
}
