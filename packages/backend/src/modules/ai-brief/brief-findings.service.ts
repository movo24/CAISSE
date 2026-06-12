import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AnalyticsStoreDailyEntity } from '../../database/entities/analytics-store-daily.entity';
import { AnalyticsStoreSessionsEntity } from '../../database/entities/analytics-store-sessions.entity';
import { AnalyticsStorePresenceEntity } from '../../database/entities/analytics-store-presence.entity';
import { AnalyticsStoreStockEntity } from '../../database/entities/analytics-store-stock.entity';
import { AnalyticsStoreRegistryEntity } from '../../database/entities/analytics-store-registry.entity';
import { AnalyticsAlertEntity } from '../../database/entities/analytics-alert.entity';
import { AnalyticsStoreTargetEntity } from '../../database/entities/analytics-store-target.entity';
import { applyStoreScope } from '../analytics-projection/store-scope.util';

/**
 * Étage 3 — DETERMINISTIC findings engine (INV-3 seam, part 1). Every comparison,
 * delta, ranking and the day's alert facts are computed HERE, from `analytics.*`
 * only (INV-2). Same inputs → identical findings (stable ordering, deterministic
 * rounding, computed_at from the data — never the wall clock). The narration layer
 * receives THIS object and nothing else: it never sees raw data to compute from.
 */
export interface BriefStoreFinding {
  storeId: string;
  name: string | null;
  caBrutMinor: number;
  netMinor: number;
  txCount: number;
  voidCount: number;
  ruptureCount: number;
  lowStockCount: number;
  presentCount: number;
  expectedCount: number;
  /** vs the previous day's caBrut; null when no/zero baseline. */
  deltaVsPrevDayPct: number | null;
  /** vs the same weekday last week; null when no/zero baseline. */
  deltaVsSameWeekdayPct: number | null;
}

export interface BriefFindings {
  businessDay: string;
  scope: { storeCount: number };
  totals: {
    caBrutMinor: number;
    netMinor: number;
    txCount: number;
    voidCount: number;
    returnsAmountMinor: number;
    discountTotalMinor: number;
    targetMinor: number | null;
    targetReachedPct: number | null;
    presentCount: number;
    expectedCount: number;
    openSessions: number;
    activeTerminals: number;
    ruptureCount: number;
    lowStockCount: number;
    alertCount: number;
  };
  stores: BriefStoreFinding[];
  alerts: Array<{ storeId: string; rule: string; thresholdBand: string; businessDay: string }>;
  /** Oldest contributing projection freshness (ISO) — the cache/gate anchor. Null = no data. */
  computedAt: string | null;
}

@Injectable()
export class BriefFindingsService {
  constructor(
    @InjectRepository(AnalyticsStoreDailyEntity) private readonly daily: Repository<AnalyticsStoreDailyEntity>,
    @InjectRepository(AnalyticsStoreSessionsEntity) private readonly sessions: Repository<AnalyticsStoreSessionsEntity>,
    @InjectRepository(AnalyticsStorePresenceEntity) private readonly presence: Repository<AnalyticsStorePresenceEntity>,
    @InjectRepository(AnalyticsStoreStockEntity) private readonly stock: Repository<AnalyticsStoreStockEntity>,
    @InjectRepository(AnalyticsStoreRegistryEntity) private readonly registry: Repository<AnalyticsStoreRegistryEntity>,
    @InjectRepository(AnalyticsAlertEntity) private readonly alerts: Repository<AnalyticsAlertEntity>,
    @InjectRepository(AnalyticsStoreTargetEntity) private readonly targets: Repository<AnalyticsStoreTargetEntity>,
  ) {}

  async build(scope: string[], businessDay: string): Promise<BriefFindings> {
    const prevDay = shiftDayStr(businessDay, -1);
    const weekAgo = shiftDayStr(businessDay, -7);

    const [dayRows, prevRows, weekRows, sessRows, presRows, stockRows, regRows, targetRows, alertRows] =
      await Promise.all([
        this.scoped(this.daily, scope, (qb) => qb.andWhere('d.business_day = :d', { d: businessDay })),
        this.scoped(this.daily, scope, (qb) => qb.andWhere('d.business_day = :d', { d: prevDay })),
        this.scoped(this.daily, scope, (qb) => qb.andWhere('d.business_day = :d', { d: weekAgo })),
        this.scoped(this.sessions, scope),
        this.scoped(this.presence, scope),
        this.scoped(this.stock, scope),
        this.scoped(this.registry, scope),
        this.scoped(this.targets, scope, (qb) => qb.andWhere('d.is_active = true')),
        this.scoped(this.alerts, scope, (qb) =>
          qb.andWhere('d.business_day IN (:...days)', { days: [businessDay, prevDay] }),
        ),
      ]);

    const byStore = <T extends { storeId: string }>(rows: T[]) =>
      new Map(rows.map((r) => [r.storeId, r]));
    const dayMap = byStore(dayRows as AnalyticsStoreDailyEntity[]);
    const prevMap = byStore(prevRows as AnalyticsStoreDailyEntity[]);
    const weekMap = byStore(weekRows as AnalyticsStoreDailyEntity[]);
    const sessMap = byStore(sessRows as AnalyticsStoreSessionsEntity[]);
    const presMap = byStore(presRows as AnalyticsStorePresenceEntity[]);
    const stockMap = byStore(stockRows as AnalyticsStoreStockEntity[]);
    const regMap = byStore(regRows as AnalyticsStoreRegistryEntity[]);

    // ── per-store findings, STABLE ordering (name, then storeId) ──
    const stores: BriefStoreFinding[] = [...scope]
      .map((storeId) => {
        const d = dayMap.get(storeId);
        const p = presMap.get(storeId);
        const k = stockMap.get(storeId);
        return {
          storeId,
          name: regMap.get(storeId)?.name ?? null,
          caBrutMinor: d?.caBrutMinor ?? 0,
          netMinor: d?.netMinor ?? 0,
          txCount: d?.txCount ?? 0,
          voidCount: d?.voidCount ?? 0,
          ruptureCount: k?.ruptureCount ?? 0,
          lowStockCount: k?.lowStockCount ?? 0,
          presentCount: p?.presentCount ?? 0,
          expectedCount: p?.expectedCount ?? 0,
          deltaVsPrevDayPct: deltaPct(d?.caBrutMinor, prevMap.get(storeId)?.caBrutMinor),
          deltaVsSameWeekdayPct: deltaPct(d?.caBrutMinor, weekMap.get(storeId)?.caBrutMinor),
        };
      })
      .sort((a, b) => (a.name ?? '').localeCompare(b.name ?? '') || a.storeId.localeCompare(b.storeId));

    const sum = <T>(rows: T[], pick: (r: T) => number) => rows.reduce((a, r) => a + (pick(r) || 0), 0);
    const targetTotal = targetRows.length
      ? sum(targetRows as AnalyticsStoreTargetEntity[], (t) => t.dailyTargetMinor)
      : null;
    const caBrutTotal = sum(dayRows as AnalyticsStoreDailyEntity[], (r) => r.caBrutMinor);

    // ── alert facts (today + the previous day), STABLE ordering ──
    const alerts = (alertRows as AnalyticsAlertEntity[])
      .map((a) => ({ storeId: a.storeId, rule: a.rule, thresholdBand: a.thresholdBand, businessDay: String(a.businessDay) }))
      .sort(
        (a, b) =>
          a.businessDay.localeCompare(b.businessDay) ||
          a.rule.localeCompare(b.rule) ||
          a.thresholdBand.localeCompare(b.thresholdBand) ||
          a.storeId.localeCompare(b.storeId),
      );

    // ── freshness from the DATA (never the wall clock) — determinism + the cache anchor ──
    const freshness = oldest([
      ...(dayRows as AnalyticsStoreDailyEntity[]).map((r) => r.computedAt),
      ...(sessRows as AnalyticsStoreSessionsEntity[]).map((r) => r.computedAt),
      ...(presRows as AnalyticsStorePresenceEntity[]).map((r) => r.computedAt),
      ...(stockRows as AnalyticsStoreStockEntity[]).map((r) => r.computedAt),
    ]);

    return {
      businessDay,
      scope: { storeCount: scope.length },
      totals: {
        caBrutMinor: caBrutTotal,
        netMinor: sum(dayRows as AnalyticsStoreDailyEntity[], (r) => r.netMinor),
        txCount: sum(dayRows as AnalyticsStoreDailyEntity[], (r) => r.txCount),
        voidCount: sum(dayRows as AnalyticsStoreDailyEntity[], (r) => r.voidCount),
        returnsAmountMinor: sum(dayRows as AnalyticsStoreDailyEntity[], (r) => r.returnsAmountMinor),
        discountTotalMinor: sum(dayRows as AnalyticsStoreDailyEntity[], (r) => r.discountTotalMinor),
        targetMinor: targetTotal,
        targetReachedPct:
          targetTotal && targetTotal > 0 ? Math.round((caBrutTotal / targetTotal) * 1000) / 10 : null,
        presentCount: sum(presRows as AnalyticsStorePresenceEntity[], (r) => r.presentCount),
        expectedCount: sum(presRows as AnalyticsStorePresenceEntity[], (r) => r.expectedCount),
        openSessions: sum(sessRows as AnalyticsStoreSessionsEntity[], (r) => r.openSessions),
        activeTerminals: sum(sessRows as AnalyticsStoreSessionsEntity[], (r) => r.activeTerminals),
        ruptureCount: sum(stockRows as AnalyticsStoreStockEntity[], (r) => r.ruptureCount),
        lowStockCount: sum(stockRows as AnalyticsStoreStockEntity[], (r) => r.lowStockCount),
        alertCount: alerts.length,
      },
      stores,
      alerts,
      computedAt: freshness ? freshness.toISOString() : null,
    };
  }

  private scoped<T extends import('typeorm').ObjectLiteral>(
    repo: Repository<T>,
    scope: string[],
    refine?: (qb: import('typeorm').SelectQueryBuilder<T>) => unknown,
  ): Promise<T[]> {
    const qb = applyStoreScope(repo.createQueryBuilder('d'), 'd', scope);
    if (refine) refine(qb);
    return qb.getMany();
  }
}

const deltaPct = (today?: number, baseline?: number): number | null => {
  if (today === undefined || !baseline || baseline === 0) return null;
  return Math.round(((today - baseline) / baseline) * 1000) / 10;
};

const shiftDayStr = (day: string, delta: number): string => {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
};

const oldest = (dates: (Date | null | undefined)[]): Date | null => {
  const ms = dates.filter(Boolean).map((d) => new Date(d as Date).getTime());
  return ms.length ? new Date(Math.min(...ms)) : null;
};
