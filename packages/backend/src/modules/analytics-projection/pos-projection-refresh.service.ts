import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { StoreEntity } from '../../database/entities/store.entity';
import { SaleEntity } from '../../database/entities/sale.entity';
import { CreditNoteEntity } from '../../database/entities/credit-note.entity';
import { PosSessionEntity } from '../../database/entities/pos-session.entity';
import { AnalyticsStoreDailyEntity } from '../../database/entities/analytics-store-daily.entity';
import { AnalyticsStoreSessionsEntity } from '../../database/entities/analytics-store-sessions.entity';
import { AnalyticsStoreRegistryEntity } from '../../database/entities/analytics-store-registry.entity';
import { AnalyticsStoreClockEntity } from '../../database/entities/analytics-store-clock.entity';
import { guardedProjectionUpsert } from './projection-upsert.util';
import { localDayString, localDayRange } from '../../common/clock/wall-clock.util';

/**
 * INV-4 — POS refresh job. CONSOLIDATES the POS source of truth into the read model
 * (analytics_store_daily / _sessions / _registry); it does NOT recompute fiscal
 * truth. The cockpit never reads sales/credit_notes/pos_sessions directly — this
 * job is the only writer of those three projections.
 *
 * Runs every 5 min (decision 5: periodic jobs, no event-driven in V1). System job:
 * refreshes ALL active stores (per-user INV-5 scope is a READ-time concern, not here).
 */
@Injectable()
export class PosProjectionRefreshService {
  private readonly logger = new Logger(PosProjectionRefreshService.name);

  constructor(
    @InjectRepository(StoreEntity) private readonly stores: Repository<StoreEntity>,
    @InjectRepository(SaleEntity) private readonly sales: Repository<SaleEntity>,
    @InjectRepository(CreditNoteEntity) private readonly creditNotes: Repository<CreditNoteEntity>,
    @InjectRepository(PosSessionEntity) private readonly sessions: Repository<PosSessionEntity>,
    @InjectRepository(AnalyticsStoreDailyEntity) private readonly projDaily: Repository<AnalyticsStoreDailyEntity>,
    @InjectRepository(AnalyticsStoreSessionsEntity) private readonly projSessions: Repository<AnalyticsStoreSessionsEntity>,
    @InjectRepository(AnalyticsStoreRegistryEntity) private readonly projRegistry: Repository<AnalyticsStoreRegistryEntity>,
    @InjectRepository(AnalyticsStoreClockEntity) private readonly clock: Repository<AnalyticsStoreClockEntity>,
  ) {}

  @Cron('*/5 * * * *')
  async refresh(): Promise<void> {
    try {
      await this.refreshAll(new Date());
    } catch (e: any) {
      this.logger.warn(`POS projection refresh failed: ${e?.message}`);
    }
  }

  /** Refresh every active store for the given clock (exposed for tests/manual runs). */
  async refreshAll(now: Date): Promise<void> {
    const stores = await this.stores.find({ where: { isActive: true } });
    for (const store of stores) {
      await this.refreshStore(store, now);
    }
  }

  async refreshStore(store: StoreEntity, now: Date): Promise<void> {
    // A1: the business day is the LOCAL calendar day in the store's clock
    // timezone (per-store override else network default; no datum -> degraded
    // UTC labelling). The day window is a pair of UTC INSTANTS bounding the
    // local day - DST-correct (23h/25h days), and pg-safe (no SQL tz functions).
    const clock =
      (await this.clock.findOne({ where: { storeId: store.id, isActive: true } })) ??
      (await this.clock.findOne({ where: { storeId: IsNull(), isActive: true } }));
    const tz = clock?.timezone ?? 'Etc/UTC';
    const day = localDayString(now, tz);
    const { start: dayStart, end: dayEnd } = localDayRange(day, tz);
    // ── daily POS summary (INV-4: copy the POS figures, don't re-derive) ──
    const completed = await this.sales
      .createQueryBuilder('s')
      .select('COALESCE(SUM(s.total_minor_units), 0)', 'ca')
      .addSelect('COALESCE(SUM(s.discount_total_minor_units), 0)', 'disc')
      .addSelect('COUNT(*)', 'cnt')
      .where('s.store_id = :sid', { sid: store.id })
      .andWhere("s.status = 'completed'")
      .andWhere('s.created_at >= :dayStart AND s.created_at < :dayEnd', { dayStart, dayEnd })
      .getRawOne<{ ca: string; disc: string; cnt: string }>();

    const voided = await this.sales
      .createQueryBuilder('s')
      .select('COALESCE(SUM(s.total_minor_units), 0)', 'amt')
      .addSelect('COUNT(*)', 'cnt')
      .where('s.store_id = :sid', { sid: store.id })
      .andWhere("s.status = 'voided'")
      .andWhere('s.created_at >= :dayStart AND s.created_at < :dayEnd', { dayStart, dayEnd })
      .getRawOne<{ amt: string; cnt: string }>();

    const returns = await this.creditNotes
      .createQueryBuilder('c')
      .select('COALESCE(SUM(c.total_minor_units), 0)', 'amt')
      .where('c.store_id = :sid', { sid: store.id })
      .andWhere('c.created_at >= :dayStart AND c.created_at < :dayEnd', { dayStart, dayEnd })
      .getRawOne<{ amt: string }>();

    const caBrut = Number(completed?.ca ?? 0);
    const discountTotal = Number(completed?.disc ?? 0);
    const txCount = Number(completed?.cnt ?? 0);
    const voidAmount = Number(voided?.amt ?? 0);
    const voidCount = Number(voided?.cnt ?? 0);
    const returnsAmount = Number(returns?.amt ?? 0);

    // guarded upsert (one row per store/day): replaces only if `now` is not stale.
    await guardedProjectionUpsert(
      this.projDaily,
      { storeId: store.id, businessDay: day },
      {
        storeId: store.id,
        businessDay: day,
        caBrutMinor: caBrut,
        txCount,
        voidCount,
        voidAmountMinor: voidAmount,
        returnsAmountMinor: returnsAmount,
        discountTotalMinor: discountTotal,
        netMinor: caBrut - returnsAmount, // voids already excluded from completed
        byTender: null, // V1: tender breakdown deferred (column ready) — flagged
        computedAt: now,
      },
      now,
      this.logger,
      'analytics_store_daily',
    );

    // ── sessions snapshot (distinct terminals computed in JS — no SQL DISTINCT) ──
    const active = await this.sessions.find({ where: { storeId: store.id, isActive: true } });
    const terminals = new Set(active.map((s) => s.terminalId).filter((t): t is string => !!t));
    await guardedProjectionUpsert(
      this.projSessions,
      { storeId: store.id },
      { storeId: store.id, openSessions: active.length, activeTerminals: terminals.size, computedAt: now },
      now,
      this.logger,
      'analytics_store_sessions',
    );

    // ── registry projection (so the cockpit reads no source table for store meta) ──
    await guardedProjectionUpsert(
      this.projRegistry,
      { storeId: store.id },
      {
        storeId: store.id,
        name: store.name,
        organizationId: store.organizationId ?? null,
        unitId: (store as any).unitId ?? null,
        isActive: store.isActive,
        computedAt: now,
      },
      now,
      this.logger,
      'analytics_store_registry',
    );
  }
}
