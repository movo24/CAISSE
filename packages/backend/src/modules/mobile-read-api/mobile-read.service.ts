import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AnalyticsStoreRegistryEntity } from '../../database/entities/analytics-store-registry.entity';
import { AnalyticsStoreDailyEntity } from '../../database/entities/analytics-store-daily.entity';
import { AnalyticsStoreSessionsEntity } from '../../database/entities/analytics-store-sessions.entity';
import { AnalyticsStorePresenceEntity } from '../../database/entities/analytics-store-presence.entity';
import { AnalyticsStoreStockEntity } from '../../database/entities/analytics-store-stock.entity';
import { applyStoreScope } from '../analytics-projection/store-scope.util';

/**
 * Étage 1 read service — reads ONLY `analytics.*` (never the source tables). Every
 * query is scoped at the QUERY layer via applyStoreScope (INV-5); `computed_at`
 * (freshness) is carried through on every payload.
 */
@Injectable()
export class MobileReadService {
  constructor(
    @InjectRepository(AnalyticsStoreRegistryEntity) private readonly registry: Repository<AnalyticsStoreRegistryEntity>,
    @InjectRepository(AnalyticsStoreDailyEntity) private readonly daily: Repository<AnalyticsStoreDailyEntity>,
    @InjectRepository(AnalyticsStoreSessionsEntity) private readonly sessions: Repository<AnalyticsStoreSessionsEntity>,
    @InjectRepository(AnalyticsStorePresenceEntity) private readonly presence: Repository<AnalyticsStorePresenceEntity>,
    @InjectRepository(AnalyticsStoreStockEntity) private readonly stock: Repository<AnalyticsStoreStockEntity>,
  ) {}

  /** GET /stores — the authorized stores (collection, silently scoped). */
  async listStores(scope: string[]): Promise<
    Array<{ storeId: string; name: string; organizationId: string | null; unitId: string | null; isActive: boolean; computedAt: Date }>
  > {
    const rows = await applyStoreScope(this.registry.createQueryBuilder('r'), 'r', scope)
      .orderBy('r.name', 'ASC')
      .getMany();
    return rows.map((r) => ({
      storeId: r.storeId,
      name: r.name,
      organizationId: r.organizationId,
      unitId: r.unitId,
      isActive: r.isActive,
      computedAt: r.computedAt,
    }));
  }

  /**
   * GET /dashboard/overview — aggregate across the scope's stores (collection, silently
   * scoped). `computedAt` is the OLDEST contributing row's freshness ("data as of at
   * least X") — honest, not the most optimistic. Aggregation in JS (one row per store
   * per projection → small + pg-mem-safe).
   */
  async overview(scope: string[], businessDay: string) {
    const daily = await applyStoreScope(this.daily.createQueryBuilder('d'), 'd', scope)
      .andWhere('d.business_day = :day', { day: businessDay })
      .getMany();
    const sessions = await applyStoreScope(this.sessions.createQueryBuilder('s'), 's', scope).getMany();
    const presence = await applyStoreScope(this.presence.createQueryBuilder('p'), 'p', scope).getMany();
    const stock = await applyStoreScope(this.stock.createQueryBuilder('k'), 'k', scope).getMany();
    const storeCount = await applyStoreScope(this.registry.createQueryBuilder('r'), 'r', scope).getCount();

    const sum = <T>(rows: T[], pick: (r: T) => number) => rows.reduce((a, r) => a + (pick(r) || 0), 0);
    const computedAt = oldest([
      ...daily.map((r) => r.computedAt),
      ...sessions.map((r) => r.computedAt),
      ...presence.map((r) => r.computedAt),
      ...stock.map((r) => r.computedAt),
    ]);

    return {
      scope: { storeCount },
      sales: {
        caNetMinor: sum(daily, (r) => r.netMinor),
        caBrutMinor: sum(daily, (r) => r.caBrutMinor),
        txCount: sum(daily, (r) => r.txCount),
        voidCount: sum(daily, (r) => r.voidCount),
        returnsAmountMinor: sum(daily, (r) => r.returnsAmountMinor),
      },
      sessions: {
        openSessions: sum(sessions, (r) => r.openSessions),
        activeTerminals: sum(sessions, (r) => r.activeTerminals),
      },
      presence: {
        presentCount: sum(presence, (r) => r.presentCount),
        expectedCount: sum(presence, (r) => r.expectedCount),
      },
      stock: {
        ruptureCount: sum(stock, (r) => r.ruptureCount),
        lowStockCount: sum(stock, (r) => r.lowStockCount),
      },
      computedAt, // oldest freshness across the aggregated rows (null if scope empty)
    };
  }

  /**
   * GET /stores/:id/live — live state of ONE store (sessions / presence / stock). The
   * caller (controller) has already gated the id against the scope (resource 404+log
   * rule); this just reads analytics.* for that store. computed_at = oldest snapshot.
   */
  async liveForStore(storeId: string) {
    const [sessions, presence, stock, registry] = await Promise.all([
      this.sessions.findOne({ where: { storeId } }),
      this.presence.findOne({ where: { storeId } }),
      this.stock.findOne({ where: { storeId } }),
      this.registry.findOne({ where: { storeId } }),
    ]);
    return {
      storeId,
      name: registry?.name ?? null,
      sessions: { openSessions: sessions?.openSessions ?? 0, activeTerminals: sessions?.activeTerminals ?? 0 },
      presence: { presentCount: presence?.presentCount ?? 0, expectedCount: presence?.expectedCount ?? 0 },
      stock: { ruptureCount: stock?.ruptureCount ?? 0, lowStockCount: stock?.lowStockCount ?? 0 },
      computedAt: oldest([sessions?.computedAt, presence?.computedAt, stock?.computedAt]),
    };
  }

  /**
   * GET /stores/:id/performance — sales performance of ONE store for the business day
   * (CA / tickets / average basket) from analytics.store_daily. Average basket =
   * caBrut / txCount (same definition as the POS metrics). Scope already gated by the
   * caller. computed_at carried through.
   */
  async performanceForStore(storeId: string, businessDay: string) {
    const d = await this.daily.findOne({ where: { storeId, businessDay } });
    const tx = d?.txCount ?? 0;
    const caBrut = d?.caBrutMinor ?? 0;
    return {
      storeId,
      businessDay,
      caBrutMinor: caBrut,
      netMinor: d?.netMinor ?? 0,
      txCount: tx,
      voidCount: d?.voidCount ?? 0,
      returnsAmountMinor: d?.returnsAmountMinor ?? 0,
      avgBasketMinor: tx > 0 ? Math.round(caBrut / tx) : 0,
      computedAt: d?.computedAt ?? null,
    };
  }
}

function oldest(dates: (Date | null | undefined)[]): Date | null {
  const ms = dates.filter(Boolean).map((d) => new Date(d as Date).getTime());
  return ms.length ? new Date(Math.min(...ms)) : null;
}
