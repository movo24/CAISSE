import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { AnalyticsStoreSessionsEntity } from '../../../database/entities/analytics-store-sessions.entity';
import { AnalyticsStoreClockEntity } from '../../../database/entities/analytics-store-clock.entity';
import { localMinutesOfDay } from '../../../common/clock/wall-clock.util';
import { StoreScheduleService, minutesOf } from '../../store-schedule/store-schedule.service';
import { AlertFact, AlertRule, AlertRuleContext } from '../alert-rule.interface';

/**
 * store_closed_late — POS sessions still OPEN past the store's closing time.
 * Source (INV-4): analytics.store_sessions open_sessions (the sessions projection).
 *
 * The closing time comes from the SCHEDULE RESOLVER (store_weekly_hours — the
 * single schedule source shared with the close beat; neither re-derives). The
 * timezone stays the store_clock datum (A1): the threshold compares LOCAL
 * wall-clock minutes, DST-correct. A day the schedule resolves CLOSED never
 * fires (an open session in a closed store is a different problem than "late").
 * No clock datum or no schedule datum → silent (no invented hours).
 */
@Injectable()
export class StoreClosedLateRule implements AlertRule {
  readonly name = 'store_closed_late';

  constructor(
    @InjectRepository(AnalyticsStoreSessionsEntity)
    private readonly sessions: Repository<AnalyticsStoreSessionsEntity>,
    @InjectRepository(AnalyticsStoreClockEntity)
    private readonly clock: Repository<AnalyticsStoreClockEntity>,
    private readonly schedule: StoreScheduleService,
  ) {}

  async evaluate({ storeId, businessDay, now }: AlertRuleContext): Promise<AlertFact[]> {
    const clock =
      (await this.clock.findOne({ where: { storeId, isActive: true } })) ??
      (await this.clock.findOne({ where: { storeId: IsNull(), isActive: true } }));
    if (!clock) return []; // no TZ datum → no invented wall-clock

    const sched = await this.schedule.resolve(storeId, businessDay);
    if (!sched) return []; // no schedule datum → no invented closing time
    if (sched === 'closed') return []; // ADVERSE (ratified): a CLOSED day never fires

    // A1: LOCAL wall-clock minutes in the datum's IANA timezone (DST-correct).
    const observedMinutes = localMinutesOfDay(now, clock.timezone);
    if (observedMinutes < minutesOf(sched.closeLocal)) return []; // legitimately open

    const s = await this.sessions.findOne({ where: { storeId } });
    if (!s || s.openSessions === 0) return []; // properly closed → silent

    const observedLocal = `${String(Math.floor(observedMinutes / 60)).padStart(2, '0')}:${String(observedMinutes % 60).padStart(2, '0')}`;
    return [
      {
        rule: this.name,
        thresholdBand: 'open_after_close',
        businessDay,
        payload: {
          openSessions: s.openSessions,
          activeTerminals: s.activeTerminals,
          closeLocal: sched.closeLocal,
          clockTimezone: clock.timezone,
          observedLocal,
        },
      },
    ];
  }
}
