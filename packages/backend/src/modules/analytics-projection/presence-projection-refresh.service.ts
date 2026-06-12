import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { StoreEntity } from '../../database/entities/store.entity';
import { AnalyticsStorePresenceEntity } from '../../database/entities/analytics-store-presence.entity';
import { TimewinService } from '../timewin/timewin.service';

/**
 * INV-4 — presence is owned by TimeWin24. There is NO local attendance table (that
 * would be a 2nd source of truth). This job SNAPSHOTS presence via the TimeWin24
 * proxy into analytics_store_presence; `computed_at` carries the freshness.
 *
 * `getTodayShifts` is a proxied call returning `any` — extractPresence adapts to the
 * response shape DEFENSIVELY. The exact field mapping must be confirmed against the
 * real TimeWin24 response (flagged); the unit test pins the assumed shape.
 */
export function extractPresence(shifts: any): { present: number; expected: number } {
  const list: any[] = Array.isArray(shifts)
    ? shifts
    : shifts?.shifts ?? shifts?.data ?? shifts?.employees ?? [];
  if (!Array.isArray(list)) return { present: 0, expected: 0 };
  const expected = list.length;
  const present = list.filter(
    (s: any) =>
      s?.present === true ||
      s?.status === 'present' ||
      s?.clockedIn === true ||
      !!s?.clockInAt ||
      !!s?.clock_in_at,
  ).length;
  return { present, expected };
}

@Injectable()
export class PresenceProjectionRefreshService {
  private readonly logger = new Logger(PresenceProjectionRefreshService.name);

  constructor(
    @InjectRepository(StoreEntity) private readonly stores: Repository<StoreEntity>,
    @InjectRepository(AnalyticsStorePresenceEntity) private readonly projPresence: Repository<AnalyticsStorePresenceEntity>,
    private readonly timewin: TimewinService,
  ) {}

  @Cron('*/5 * * * *')
  async refresh(): Promise<void> {
    try {
      await this.refreshAll(new Date());
    } catch (e: any) {
      this.logger.warn(`Presence projection refresh failed: ${e?.message}`);
    }
  }

  async refreshAll(now: Date): Promise<void> {
    const stores = await this.stores.find({ where: { isActive: true } });
    for (const store of stores) {
      let shifts: any;
      try {
        shifts = await this.timewin.getTodayShifts(store.id);
      } catch (e: any) {
        // Proxy unreachable → keep the last snapshot (do NOT wipe to zero on outage).
        this.logger.warn(`presence: TimeWin24 unreachable for store ${store.id}: ${e?.message}`);
        continue;
      }
      const { present, expected } = extractPresence(shifts);
      await this.projPresence.delete({ storeId: store.id });
      await this.projPresence.insert({
        storeId: store.id,
        presentCount: present,
        expectedCount: expected,
        computedAt: now,
      });
    }
  }
}
