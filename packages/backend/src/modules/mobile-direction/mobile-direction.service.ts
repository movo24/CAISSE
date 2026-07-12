import { Injectable } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';

import { StoreEntity } from '../../database/entities/store.entity';
import { EmployeeStoreAccessEntity } from '../../database/entities/employee-store-access.entity';
import {
  averageBasketMinorUnits,
  fillHourly,
  marginRate,
  rankStores,
  sumStoreRows,
  toInt,
  toPeriodTotals,
  variationPct,
  StoreDayRow,
} from './direction-kpi';

interface DirectionUser {
  employeeId: string;
  storeId: string;
  role: string;
}

/**
 * Wesley Control — read-only network KPI service for the direction mobile app.
 *
 * READ-ONLY BY CONSTRUCTION: every query is a SELECT (raw SQL, Postgres). No
 * repository save/update/delete is ever called here. Day bucketing uses
 * DATE(completed_at) — the same convention as ReportsService.getStoreKpi, so
 * mobile figures always match the existing back-office reports.
 *
 * Tenant isolation: every aggregate is constrained to an explicit array of
 * accessible store ids (resolved from the JWT — admin: all active stores;
 * manager: home store + employee_store_access rows). No query trusts a
 * client-provided storeId without that scope filter.
 */
@Injectable()
export class MobileDirectionService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRepository(StoreEntity)
    private readonly storeRepo: Repository<StoreEntity>,
    @InjectRepository(EmployeeStoreAccessEntity)
    private readonly accessRepo: Repository<EmployeeStoreAccessEntity>,
  ) {}

  // ── scope ──────────────────────────────────────────────────────────────

  /**
   * Store ids the caller may read. Admin: every active, non-archived store.
   * Manager: home store + explicit employee_store_access grants (intersected
   * with active stores so an archived store never leaks back through a grant).
   */
  async accessibleStoreIds(user: DirectionUser): Promise<string[]> {
    const active = await this.storeRepo.find({
      where: { isActive: true, isArchived: false },
      select: ['id'],
    });
    const activeIds = new Set(active.map((s) => s.id));
    if (user.role === 'admin') return [...activeIds];

    const granted = await this.accessRepo.find({
      where: { employeeId: user.employeeId },
    });
    const mine = new Set<string>([user.storeId]);
    for (const g of granted) mine.add(g.storeId);
    return [...mine].filter((id) => activeIds.has(id));
  }

  // ── network overview ───────────────────────────────────────────────────

  async overview(scope: string[], date: string) {
    if (scope.length === 0) return this.emptyOverview(date);

    const [
      todayRows,
      previousTotals,
      toDateTotals,
      payments,
      refunds,
      voids,
      margin,
      stockCounts,
      anomalies,
      openSessions,
      storeNames,
    ] = await Promise.all([
      this.perStoreDay(scope, date),
      this.previousTotals(scope, date),
      this.toDateTotals(scope, date),
      this.paymentsBreakdown(scope, date),
      this.refundsForDay(scope, date),
      this.voidsForDay(scope, date),
      this.marginForDay(scope, date),
      this.stockAlertCounts(scope),
      this.openAnomaliesCount(scope),
      this.openSessionStoreIds(scope),
      this.storeNameMap(scope),
    ]);

    const totals = sumStoreRows(todayRows);
    const ranked = rankStores(
      todayRows.map((r) => ({
        storeId: r.storeId,
        name: storeNames.get(r.storeId) ?? r.storeId,
        revenueMinorUnits: r.revenueMinorUnits,
      })),
    );

    return {
      date,
      generatedAt: new Date().toISOString(),
      scope: { storeCount: scope.length },
      today: {
        ...toPeriodTotals(totals.revenueMinorUnits, totals.transactionCount),
        discountTotalMinorUnits: margin.discountTotalMinorUnits,
        marginMinorUnits: margin.marginMinorUnits,
        marginRatePct: marginRate(
          margin.marginMinorUnits,
          margin.marginRevenueMinorUnits,
        ),
        marginCoveragePct: margin.coveragePct,
      },
      comparisons: {
        vsYesterdayPct: variationPct(
          totals.revenueMinorUnits,
          previousTotals.yesterdayRevenue,
        ),
        vsSameDayLastWeekPct: variationPct(
          totals.revenueMinorUnits,
          previousTotals.lastWeekRevenue,
        ),
      },
      toDate: toDateTotals,
      payments,
      refunds,
      voids,
      stores: {
        total: scope.length,
        withSalesToday: todayRows.filter((r) => r.transactionCount > 0).length,
        withOpenSession: openSessions.length,
      },
      alerts: {
        stockCritical: stockCounts.critical,
        stockAlert: stockCounts.alert,
        anomaliesOpen: anomalies,
      },
      ranking: ranked,
    };
  }

  // ── store list ─────────────────────────────────────────────────────────

  async storeList(scope: string[], date: string) {
    if (scope.length === 0) return { date, stores: [] };

    const yesterday = shiftDay(date, -1);
    const [stores, todayRows, yesterdayRows, openSessions, stockRows, anomalyRows, lastSales] =
      await Promise.all([
        this.storeRepo.find({ where: scope.map((id) => ({ id })) }),
        this.perStoreDay(scope, date),
        this.perStoreDay(scope, yesterday),
        this.openSessionStoreIds(scope),
        this.stockAlertCountsPerStore(scope),
        this.openAnomaliesPerStore(scope),
        this.lastSaleAtPerStore(scope),
      ]);

    const today = new Map<string, StoreDayRow>(
      todayRows.map((r) => [r.storeId, r]),
    );
    const prev = new Map<string, StoreDayRow>(
      yesterdayRows.map((r) => [r.storeId, r]),
    );
    const open = new Set(openSessions);

    const rows = stores
      .map((s) => {
        const t = today.get(s.id);
        const revenue = t?.revenueMinorUnits ?? 0;
        const tx = t?.transactionCount ?? 0;
        return {
          storeId: s.id,
          name: s.name,
          city: s.city ?? null,
          revenueMinorUnits: revenue,
          transactionCount: tx,
          averageBasketMinorUnits: averageBasketMinorUnits(revenue, tx),
          vsYesterdayPct: variationPct(
            revenue,
            prev.get(s.id)?.revenueMinorUnits ?? 0,
          ),
          hasOpenSession: open.has(s.id),
          lastSaleAt: lastSales.get(s.id) ?? null,
          stockCriticalCount: stockRows.get(s.id)?.critical ?? 0,
          stockAlertCount: stockRows.get(s.id)?.alert ?? 0,
          anomaliesOpenCount: anomalyRows.get(s.id) ?? 0,
        };
      })
      .sort((a, b) => b.revenueMinorUnits - a.revenueMinorUnits);

    return { date, stores: rows };
  }

  // ── store detail ───────────────────────────────────────────────────────

  async storeDetail(storeId: string, date: string) {
    const scope = [storeId];
    const [
      store,
      dayRows,
      hourly,
      payments,
      topProducts,
      refunds,
      voids,
      margin,
      cashVariance,
      terminals,
      openSessions,
      stockCounts,
      anomalies,
    ] = await Promise.all([
      this.storeRepo.findOne({ where: { id: storeId } }),
      this.perStoreDay(scope, date),
      this.hourlyForStore(storeId, date),
      this.paymentsBreakdown(scope, date),
      this.topProducts(storeId, date),
      this.refundsForDay(scope, date),
      this.voidsForDay(scope, date),
      this.marginForDay(scope, date),
      this.cashVarianceForDay(storeId, date),
      this.terminalsForStore(storeId),
      this.openSessionsForStore(storeId),
      this.stockAlertCounts(scope),
      this.openAnomaliesCount(scope),
    ]);

    const totals = sumStoreRows(dayRows);
    return {
      date,
      generatedAt: new Date().toISOString(),
      store: store
        ? {
            id: store.id,
            name: store.name,
            city: store.city ?? null,
            isActive: store.isActive,
          }
        : null,
      kpi: {
        ...toPeriodTotals(totals.revenueMinorUnits, totals.transactionCount),
        discountTotalMinorUnits: margin.discountTotalMinorUnits,
        marginMinorUnits: margin.marginMinorUnits,
        marginRatePct: marginRate(
          margin.marginMinorUnits,
          margin.marginRevenueMinorUnits,
        ),
      },
      hourly: fillHourly(hourly),
      payments,
      topProducts,
      refunds,
      voids,
      cash: cashVariance,
      sessions: { open: openSessions },
      terminals,
      alerts: {
        stockCritical: stockCounts.critical,
        stockAlert: stockCounts.alert,
        anomaliesOpen: anomalies,
      },
    };
  }

  // ── comparator ─────────────────────────────────────────────────────────

  async compare(storeIds: string[], from: string, to: string) {
    if (storeIds.length === 0) return { from, to, stores: [] };
    const [rows, margins, names] = await Promise.all([
      this.dataSource.query(
        `SELECT s.store_id AS "storeId",
                COALESCE(SUM(s.total_minor_units), 0)::bigint AS "revenue",
                COUNT(s.id)::bigint AS "tx"
         FROM sales s
         WHERE s.status = 'completed'
           AND s.store_id = ANY($1)
           AND DATE(s.completed_at) BETWEEN $2 AND $3
         GROUP BY s.store_id`,
        [storeIds, from, to],
      ),
      this.dataSource.query(
        `SELECT s.store_id AS "storeId",
                SUM(li.line_total_minor_units - li.quantity * p.cost_minor_units)::bigint AS "margin"
         FROM sale_line_items li
         JOIN sales s ON s.id = li.sale_id
         JOIN products p ON p.id = li.product_id AND p.cost_minor_units IS NOT NULL
         WHERE s.status = 'completed'
           AND s.store_id = ANY($1)
           AND DATE(s.completed_at) BETWEEN $2 AND $3
         GROUP BY s.store_id`,
        [storeIds, from, to],
      ),
      this.storeNameMap(storeIds),
    ]);

    const marginByStore = new Map<string, number>(
      margins.map((m: any) => [m.storeId, toInt(m.margin)]),
    );
    const byStore = new Map<string, any>(rows.map((r: any) => [r.storeId, r]));

    return {
      from,
      to,
      stores: storeIds
        .map((id) => {
          const r = byStore.get(id);
          const revenue = toInt(r?.revenue);
          const tx = toInt(r?.tx);
          return {
            storeId: id,
            name: names.get(id) ?? id,
            revenueMinorUnits: revenue,
            transactionCount: tx,
            averageBasketMinorUnits: averageBasketMinorUnits(revenue, tx),
            marginMinorUnits: marginByStore.get(id) ?? null,
          };
        })
        .sort((a, b) => b.revenueMinorUnits - a.revenueMinorUnits),
    };
  }

  // ── private query helpers (all SELECT-only) ────────────────────────────

  private async perStoreDay(
    scope: string[],
    date: string,
  ): Promise<StoreDayRow[]> {
    const rows = await this.dataSource.query(
      `SELECT store_id AS "storeId",
              COALESCE(SUM(total_minor_units), 0)::bigint AS "revenue",
              COUNT(id)::bigint AS "tx"
       FROM sales
       WHERE status = 'completed' AND store_id = ANY($1) AND DATE(completed_at) = $2
       GROUP BY store_id`,
      [scope, date],
    );
    return rows.map((r: any) => ({
      storeId: r.storeId as string,
      revenueMinorUnits: toInt(r.revenue),
      transactionCount: toInt(r.tx),
    }));
  }

  private async previousTotals(scope: string[], date: string) {
    const [y, w] = await Promise.all([
      this.rangeRevenue(scope, shiftDay(date, -1), shiftDay(date, -1)),
      this.rangeRevenue(scope, shiftDay(date, -7), shiftDay(date, -7)),
    ]);
    return { yesterdayRevenue: y, lastWeekRevenue: w };
  }

  private async toDateTotals(scope: string[], date: string) {
    const d = new Date(`${date}T00:00:00Z`);
    const monday = shiftDay(date, -((d.getUTCDay() + 6) % 7));
    const firstOfMonth = `${date.slice(0, 8)}01`;
    const firstOfYear = `${date.slice(0, 5)}01-01`;
    const [week, month, year] = await Promise.all([
      this.rangeRevenue(scope, monday, date),
      this.rangeRevenue(scope, firstOfMonth, date),
      this.rangeRevenue(scope, firstOfYear, date),
    ]);
    return {
      weekRevenueMinorUnits: week,
      monthRevenueMinorUnits: month,
      yearRevenueMinorUnits: year,
    };
  }

  private async rangeRevenue(
    scope: string[],
    from: string,
    to: string,
  ): Promise<number> {
    const [row] = await this.dataSource.query(
      `SELECT COALESCE(SUM(total_minor_units), 0)::bigint AS "revenue"
       FROM sales
       WHERE status = 'completed' AND store_id = ANY($1)
         AND DATE(completed_at) BETWEEN $2 AND $3`,
      [scope, from, to],
    );
    return toInt(row?.revenue);
  }

  private async paymentsBreakdown(scope: string[], date: string) {
    const rows = await this.dataSource.query(
      `SELECT p.method AS "method",
              COUNT(p.id)::bigint AS "count",
              COALESCE(SUM(p.amount_minor_units), 0)::bigint AS "amount"
       FROM sale_payments p
       JOIN sales s ON s.id = p.sale_id
       WHERE s.status = 'completed' AND s.store_id = ANY($1) AND DATE(s.completed_at) = $2
       GROUP BY p.method
       ORDER BY SUM(p.amount_minor_units) DESC`,
      [scope, date],
    );
    return rows.map((r: any) => ({
      method: r.method as string,
      count: toInt(r.count),
      amountMinorUnits: toInt(r.amount),
    }));
  }

  private async refundsForDay(scope: string[], date: string) {
    const [row] = await this.dataSource.query(
      `SELECT COUNT(id)::bigint AS "count",
              COALESCE(SUM(total_minor_units), 0)::bigint AS "total"
       FROM credit_notes
       WHERE store_id = ANY($1) AND status <> 'cancelled' AND DATE(created_at) = $2`,
      [scope, date],
    );
    return { count: toInt(row?.count), totalMinorUnits: toInt(row?.total) };
  }

  private async voidsForDay(scope: string[], date: string) {
    const [row] = await this.dataSource.query(
      `SELECT COUNT(id)::bigint AS "count"
       FROM sales
       WHERE status = 'voided' AND store_id = ANY($1) AND DATE(created_at) = $2`,
      [scope, date],
    );
    return { count: toInt(row?.count) };
  }

  /**
   * Gross margin for the day. Margin only counts lines whose product has a
   * cost price; `coveragePct` says how much of the revenue that represents so
   * the UI can flag a partial margin instead of presenting it as exact.
   */
  private async marginForDay(scope: string[], date: string) {
    const [row] = await this.dataSource.query(
      `SELECT COALESCE(SUM(s.discount_total_minor_units), 0)::bigint AS "discounts",
              SUM(li.line_total_minor_units - li.quantity * p.cost_minor_units)
                FILTER (WHERE p.cost_minor_units IS NOT NULL)::bigint AS "margin",
              COALESCE(SUM(li.line_total_minor_units)
                FILTER (WHERE p.cost_minor_units IS NOT NULL), 0)::bigint AS "coveredRevenue",
              COALESCE(SUM(li.line_total_minor_units), 0)::bigint AS "lineRevenue"
       FROM sales s
       LEFT JOIN sale_line_items li ON li.sale_id = s.id
       LEFT JOIN products p ON p.id = li.product_id
       WHERE s.status = 'completed' AND s.store_id = ANY($1) AND DATE(s.completed_at) = $2`,
      [scope, date],
    );
    const lineRevenue = toInt(row?.lineRevenue);
    const covered = toInt(row?.coveredRevenue);
    return {
      discountTotalMinorUnits: toInt(row?.discounts),
      marginMinorUnits: row?.margin === null || row?.margin === undefined ? null : toInt(row.margin),
      marginRevenueMinorUnits: covered,
      coveragePct:
        lineRevenue > 0 ? Math.round((covered / lineRevenue) * 100) : null,
    };
  }

  private async stockAlertCounts(scope: string[]) {
    const [row] = await this.dataSource.query(
      `SELECT COUNT(*) FILTER (WHERE stock_quantity <= stock_critical_threshold)::bigint AS "critical",
              COUNT(*) FILTER (
                WHERE stock_quantity > stock_critical_threshold
                  AND stock_quantity <= stock_alert_threshold
              )::bigint AS "alert"
       FROM products
       WHERE store_id = ANY($1) AND is_active = true`,
      [scope],
    );
    return { critical: toInt(row?.critical), alert: toInt(row?.alert) };
  }

  private async stockAlertCountsPerStore(scope: string[]) {
    const rows = await this.dataSource.query(
      `SELECT store_id AS "storeId",
              COUNT(*) FILTER (WHERE stock_quantity <= stock_critical_threshold)::bigint AS "critical",
              COUNT(*) FILTER (
                WHERE stock_quantity > stock_critical_threshold
                  AND stock_quantity <= stock_alert_threshold
              )::bigint AS "alert"
       FROM products
       WHERE store_id = ANY($1) AND is_active = true
       GROUP BY store_id`,
      [scope],
    );
    return new Map<string, { critical: number; alert: number }>(
      rows.map((r: any) => [
        r.storeId,
        { critical: toInt(r.critical), alert: toInt(r.alert) },
      ]),
    );
  }

  private async openAnomaliesCount(scope: string[]): Promise<number> {
    const [row] = await this.dataSource.query(
      `SELECT COUNT(id)::bigint AS "count"
       FROM sale_anomaly_logs
       WHERE store_id = ANY($1) AND status = 'detected'`,
      [scope],
    );
    return toInt(row?.count);
  }

  private async openAnomaliesPerStore(scope: string[]) {
    const rows = await this.dataSource.query(
      `SELECT store_id AS "storeId", COUNT(id)::bigint AS "count"
       FROM sale_anomaly_logs
       WHERE store_id = ANY($1) AND status = 'detected'
       GROUP BY store_id`,
      [scope],
    );
    return new Map<string, number>(
      rows.map((r: any) => [r.storeId, toInt(r.count)]),
    );
  }

  private async openSessionStoreIds(scope: string[]): Promise<string[]> {
    const rows = await this.dataSource.query(
      `SELECT DISTINCT store_id AS "storeId"
       FROM pos_sessions
       WHERE is_active = true AND store_id = ANY($1)`,
      [scope],
    );
    return rows.map((r: any) => r.storeId as string);
  }

  private async lastSaleAtPerStore(scope: string[]) {
    const rows = await this.dataSource.query(
      `SELECT store_id AS "storeId", MAX(completed_at) AS "lastSaleAt"
       FROM sales
       WHERE status = 'completed' AND store_id = ANY($1)
       GROUP BY store_id`,
      [scope],
    );
    return new Map<string, string>(
      rows.map((r: any) => [
        r.storeId,
        r.lastSaleAt instanceof Date ? r.lastSaleAt.toISOString() : r.lastSaleAt,
      ]),
    );
  }

  private async hourlyForStore(storeId: string, date: string) {
    const rows = await this.dataSource.query(
      `SELECT EXTRACT(HOUR FROM completed_at)::int AS "hour",
              COALESCE(SUM(total_minor_units), 0)::bigint AS "revenue",
              COUNT(id)::bigint AS "tx"
       FROM sales
       WHERE status = 'completed' AND store_id = $1 AND DATE(completed_at) = $2
       GROUP BY 1 ORDER BY 1`,
      [storeId, date],
    );
    return rows.map((r: any) => ({
      hour: toInt(r.hour),
      revenueMinorUnits: toInt(r.revenue),
      transactionCount: toInt(r.tx),
    }));
  }

  private async topProducts(storeId: string, date: string, take = 10) {
    const rows = await this.dataSource.query(
      `SELECT li.product_id AS "productId",
              MAX(li.product_name) AS "name",
              SUM(li.quantity)::bigint AS "quantity",
              COALESCE(SUM(li.line_total_minor_units), 0)::bigint AS "revenue"
       FROM sale_line_items li
       JOIN sales s ON s.id = li.sale_id
       WHERE s.status = 'completed' AND s.store_id = $1 AND DATE(s.completed_at) = $2
       GROUP BY li.product_id
       ORDER BY SUM(li.line_total_minor_units) DESC
       LIMIT $3`,
      [storeId, date, take],
    );
    return rows.map((r: any) => ({
      productId: r.productId as string,
      name: r.name as string,
      quantity: toInt(r.quantity),
      revenueMinorUnits: toInt(r.revenue),
    }));
  }

  /**
   * Écart de caisse du jour = somme des `cash_difference_minor_units` figés à
   * la clôture (compté − attendu). `varianceMinorUnits` est null (pas 0) quand
   * aucune session comptée n'existe — l'UI affiche « — », jamais un faux zéro.
   */
  private async cashVarianceForDay(storeId: string, date: string) {
    const [row] = await this.dataSource.query(
      `SELECT COUNT(id) FILTER (WHERE cash_difference_minor_units IS NOT NULL)::bigint AS "closedCounted",
              SUM(cash_difference_minor_units)::bigint AS "variance"
       FROM pos_sessions
       WHERE store_id = $1 AND is_active = false AND DATE(closed_at) = $2`,
      [storeId, date],
    );
    const counted = toInt(row?.closedCounted);
    return {
      closedSessionsCounted: counted,
      varianceMinorUnits: counted > 0 ? toInt(row?.variance) : null,
    };
  }

  private async terminalsForStore(storeId: string) {
    const rows = await this.dataSource.query(
      `SELECT id, label, status, last_seen_at AS "lastSeenAt"
       FROM payment_terminals
       WHERE store_id = $1 AND is_active = true
       ORDER BY label`,
      [storeId],
    );
    return rows.map((r: any) => ({
      id: r.id as string,
      label: r.label as string,
      status: r.status as string,
      lastSeenAt:
        r.lastSeenAt instanceof Date ? r.lastSeenAt.toISOString() : r.lastSeenAt,
    }));
  }

  private async openSessionsForStore(storeId: string) {
    const rows = await this.dataSource.query(
      `SELECT id, employee_name AS "employeeName", terminal_id AS "terminalId",
              opened_at AS "openedAt"
       FROM pos_sessions
       WHERE store_id = $1 AND is_active = true
       ORDER BY opened_at ASC`,
      [storeId],
    );
    return rows.map((r: any) => ({
      id: r.id as string,
      employeeName: r.employeeName as string,
      terminalId: (r.terminalId ?? null) as string | null,
      openedAt:
        r.openedAt instanceof Date ? r.openedAt.toISOString() : r.openedAt,
    }));
  }

  private async storeNameMap(scope: string[]): Promise<Map<string, string>> {
    if (scope.length === 0) return new Map();
    const stores = await this.storeRepo.find({
      where: scope.map((id) => ({ id })),
      select: ['id', 'name'],
    });
    return new Map(stores.map((s) => [s.id, s.name]));
  }

  private emptyOverview(date: string) {
    return {
      date,
      generatedAt: new Date().toISOString(),
      scope: { storeCount: 0 },
      today: {
        ...toPeriodTotals(0, 0),
        discountTotalMinorUnits: 0,
        marginMinorUnits: null,
        marginRatePct: null,
        marginCoveragePct: null,
      },
      comparisons: { vsYesterdayPct: null, vsSameDayLastWeekPct: null },
      toDate: {
        weekRevenueMinorUnits: 0,
        monthRevenueMinorUnits: 0,
        yearRevenueMinorUnits: 0,
      },
      payments: [],
      refunds: { count: 0, totalMinorUnits: 0 },
      voids: { count: 0 },
      stores: { total: 0, withSalesToday: 0, withOpenSession: 0 },
      alerts: { stockCritical: 0, stockAlert: 0, anomaliesOpen: 0 },
      ranking: { best: [], worst: [] },
    };
  }
}

/** Shift an ISO day string by N days (UTC-safe, no DST surprises). */
export function shiftDay(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
