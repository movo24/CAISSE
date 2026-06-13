import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { AnalyticsStoreRegistryEntity } from '../../database/entities/analytics-store-registry.entity';
import { AnalyticsStoreDailyEntity } from '../../database/entities/analytics-store-daily.entity';
import { AnalyticsStoreSessionsEntity } from '../../database/entities/analytics-store-sessions.entity';
import { AnalyticsStorePresenceEntity } from '../../database/entities/analytics-store-presence.entity';
import { AnalyticsStoreStockEntity } from '../../database/entities/analytics-store-stock.entity';
import { AnalyticsAlertEntity } from '../../database/entities/analytics-alert.entity';
import { AnalyticsAlertConfigEntity } from '../../database/entities/analytics-alert-config.entity';
import { AnalyticsAlertCursorEntity } from '../../database/entities/analytics-alert-cursor.entity';
import { AnalyticsStoreClockEntity } from '../../database/entities/analytics-store-clock.entity';
import { localDayString } from '../../common/clock/wall-clock.util';
import { AlertFact, AlertRule, ALERT_RULES } from './alert-rule.interface';

export interface StoreEvaluation {
  storeId: string;
  gated: boolean;
  created: number;
  deduped: number;
}

/**
 * Étage 2 — alerts engine. Generates + persists + dedups alert FACTS derived from
 * `analytics.*`. No delivery here (étage 4).
 *
 * INV-2: every read is an analytics.* table — INCLUDING the store list
 * (store_registry projection, never the source `stores`).
 * Gate: a store is evaluated ONLY when its projection freshness (max computed_at)
 * has ADVANCED past the per-store cursor — idempotence anchored on the étage-0
 * computed_at monotonicity (hard guard), not on the engine's own clock.
 * INV-6 (prevent-at-write): the UNIQUE (store, rule, day, band) index absorbs any
 * re-fire — insert + 23505 → dedup; never check-then-insert.
 */
@Injectable()
export class AlertsEngineService {
  private readonly logger = new Logger(AlertsEngineService.name);

  constructor(
    @InjectRepository(AnalyticsStoreRegistryEntity) private readonly registry: Repository<AnalyticsStoreRegistryEntity>,
    @InjectRepository(AnalyticsStoreDailyEntity) private readonly daily: Repository<AnalyticsStoreDailyEntity>,
    @InjectRepository(AnalyticsStoreSessionsEntity) private readonly sessions: Repository<AnalyticsStoreSessionsEntity>,
    @InjectRepository(AnalyticsStorePresenceEntity) private readonly presence: Repository<AnalyticsStorePresenceEntity>,
    @InjectRepository(AnalyticsStoreStockEntity) private readonly stock: Repository<AnalyticsStoreStockEntity>,
    @InjectRepository(AnalyticsAlertEntity) private readonly alerts: Repository<AnalyticsAlertEntity>,
    @InjectRepository(AnalyticsAlertConfigEntity) private readonly config: Repository<AnalyticsAlertConfigEntity>,
    @InjectRepository(AnalyticsAlertCursorEntity) private readonly cursor: Repository<AnalyticsAlertCursorEntity>,
    @InjectRepository(AnalyticsStoreClockEntity) private readonly storeClock: Repository<AnalyticsStoreClockEntity>,
    @Optional() @Inject(ALERT_RULES) private readonly rules: AlertRule[] = [],
  ) {}

  // Offset cron (:02, :07, …) so each pass runs AFTER the every-5-min projection refresh.
  @Cron('2-59/5 * * * *')
  async tick(): Promise<void> {
    try {
      await this.evaluateAll(new Date());
    } catch (e: any) {
      this.logger.warn(`alerts evaluation failed: ${e?.message}`);
    }
  }

  async evaluateAll(now: Date): Promise<StoreEvaluation[]> {
    const stores = await this.registry.find({ where: { isActive: true } }); // INV-2: registry projection
    const out: StoreEvaluation[] = [];
    for (const s of stores) {
      out.push(await this.evaluateStore(s.storeId, now));
    }
    return out;
  }

  async evaluateStore(storeId: string, now: Date): Promise<StoreEvaluation> {
    // A1: the business day is the LOCAL calendar day (per-store clock else default).
    const clock =
      (await this.storeClock.findOne({ where: { storeId, isActive: true } })) ??
      (await this.storeClock.findOne({ where: { storeId: IsNull(), isActive: true } }));
    const businessDay = localDayString(now, clock?.timezone ?? 'Etc/UTC');
    const freshness = await this.latestComputedAt(storeId, businessDay);
    if (!freshness) return { storeId, gated: true, created: 0, deduped: 0 };

    // ── computed_at gate: only evaluate if the projection has ADVANCED ──
    const cur = await this.cursor.findOne({ where: { storeId } });
    if (cur && new Date(cur.lastComputedAt).getTime() >= freshness.getTime()) {
      return { storeId, gated: true, created: 0, deduped: 0 };
    }

    let created = 0;
    let deduped = 0;
    for (const rule of this.rules ?? []) {
      let facts: AlertFact[] = [];
      try {
        const params = await this.paramsFor(rule.name, storeId);
        facts = await rule.evaluate({ storeId, businessDay, now, params });
      } catch (e: any) {
        this.logger.warn(`alert rule ${rule.name} failed for store ${storeId}: ${e?.message}`);
        continue; // one broken rule never blocks the others
      }
      for (const f of facts) {
        (await this.insertDeduped(storeId, f, freshness)) === 'created' ? created++ : deduped++;
      }
    }

    await this.cursor.save({ storeId, lastComputedAt: freshness });
    return { storeId, gated: false, created, deduped };
  }

  /** Store override else seeded default; null = no config (rule decides to skip). */
  private async paramsFor(rule: string, storeId: string): Promise<Record<string, unknown> | null> {
    const override = await this.config.findOne({ where: { rule, storeId } });
    if (override) return override.isActive ? override.params : null;
    const def = await this.config.findOne({ where: { rule, storeId: IsNull() } });
    return def?.isActive ? def.params : null;
  }

  /** Max computed_at across the store's projections (today's daily + the snapshots). */
  private async latestComputedAt(storeId: string, businessDay: string): Promise<Date | null> {
    const [d, s, p, k] = await Promise.all([
      this.daily.findOne({ where: { storeId, businessDay } }),
      this.sessions.findOne({ where: { storeId } }),
      this.presence.findOne({ where: { storeId } }),
      this.stock.findOne({ where: { storeId } }),
    ]);
    const ms = [d, s, p, k]
      .filter(Boolean)
      .map((r) => new Date((r as { computedAt: Date }).computedAt).getTime());
    return ms.length ? new Date(Math.max(...ms)) : null;
  }

  /** INV-6 prevent-at-write: the unique index absorbs the re-fire. */
  private async insertDeduped(storeId: string, f: AlertFact, freshness: Date): Promise<'created' | 'deduped'> {
    try {
      await this.alerts.insert({
        storeId,
        rule: f.rule,
        businessDay: f.businessDay,
        thresholdBand: f.thresholdBand,
        payload: (f.payload ?? null) as AnalyticsAlertEntity['payload'],
        computedAt: freshness,
      } as Parameters<Repository<AnalyticsAlertEntity>['insert']>[0]);
      return 'created';
    } catch (e: any) {
      if (isUniqueViolation(e)) return 'deduped';
      throw e;
    }
  }
}


const isUniqueViolation = (e: any): boolean =>
  e?.code === '23505' ||
  e?.driverError?.code === '23505' ||
  /duplicate|unique/i.test(e?.message ?? '');
