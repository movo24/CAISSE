import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { SaleEntity } from '../../database/entities/sale.entity';
import {
  buildCategories,
  buildCompareDelta,
  buildKpis,
  buildStoreRanking,
  fillSeries,
  growthPct,
  num,
  parseWindow,
  previousWindow,
  resolveBucket,
  safeTimezone,
  yearAgoWindow,
  CompareSide,
  MAX_SERIES_STORES,
  PeriodKpis,
  SeriesBucket,
  SeriesPointComponents,
  StoreSortKey,
  TimeWindow,
} from './analytics';
import { BadRequestException } from '@nestjs/common';

/**
 * P366 — Mobile network analytics (READ-ONLY).
 *
 * Every public method only ever SELECTs. No INSERT/UPDATE/DELETE exists in this
 * file — the mobile app must not be able to mutate POS data through this API.
 *
 * Scoping contract (enforced by the controller): `storeId === null` means
 * network-wide (admin only); otherwise every aggregate is restricted to that
 * store. Money is integer minor units end to end.
 *
 * Definitions (documented, applied consistently):
 * - CA / tickets / panier moyen  → sales with status = 'completed' only.
 * - Annulations                  → sales with status = 'voided' (counted apart).
 * - Remboursements               → credit_notes issued in the window (apart).
 * - Day/hour buckets             → computed in the requested IANA timezone
 *                                  (whitelisted, default Europe/Paris).
 */
@Injectable()
export class MobileAnalyticsService {
  constructor(
    @InjectRepository(SaleEntity)
    private readonly saleRepo: Repository<SaleEntity>,
  ) {}

  private q<T = any>(sql: string, params: any[]): Promise<T[]> {
    return this.saleRepo.query(sql, params);
  }

  /** WHERE fragment + params for completed sales in a window, optional store. */
  private win(w: TimeWindow, storeId: string | null, p: any[] = []): { where: string; params: any[] } {
    const params = [...p, w.from.toISOString(), w.to.toISOString()];
    let where = `s.status = 'completed' AND s.created_at >= $${params.length - 1} AND s.created_at < $${params.length}`;
    if (storeId) {
      params.push(storeId);
      where += ` AND s.store_id = $${params.length}`;
    }
    return { where, params };
  }

  // ── KPI block (CA, tickets, remises, articles, avoirs, annulations) ────────

  async kpis(w: TimeWindow, storeId: string | null): Promise<PeriodKpis> {
    const { where, params } = this.win(w, storeId);
    const [main] = await this.q(
      `SELECT COALESCE(SUM(s.total_minor_units),0) AS revenue,
              COUNT(*) AS tickets,
              COALESCE(SUM(s.discount_total_minor_units),0) AS discount,
              COUNT(DISTINCT s.store_id) AS active_stores
         FROM sales s WHERE ${where}`,
      params,
    );
    const [items] = await this.q(
      `SELECT COALESCE(SUM(li.quantity),0) AS qty
         FROM sale_line_items li JOIN sales s ON s.id = li.sale_id WHERE ${where}`,
      params,
    );

    const cnParams: any[] = [w.from.toISOString(), w.to.toISOString()];
    let cnWhere = `cn.created_at >= $1 AND cn.created_at < $2`;
    if (storeId) {
      cnParams.push(storeId);
      cnWhere += ` AND cn.store_id = $3`;
    }
    const [refunds] = await this.q(
      `SELECT COUNT(*) AS count, COALESCE(SUM(cn.total_minor_units),0) AS amount
         FROM credit_notes cn WHERE ${cnWhere}`,
      cnParams,
    );

    const vParams: any[] = [w.from.toISOString(), w.to.toISOString()];
    let vWhere = `s.status = 'voided' AND s.created_at >= $1 AND s.created_at < $2`;
    if (storeId) {
      vParams.push(storeId);
      vWhere += ` AND s.store_id = $3`;
    }
    const [voided] = await this.q(`SELECT COUNT(*) AS count FROM sales s WHERE ${vWhere}`, vParams);

    return buildKpis(
      main,
      num(items?.qty),
      { count: num(refunds?.count), amountMinorUnits: num(refunds?.amount) },
      num(voided?.count),
    );
  }

  // ── Vue d'ensemble ─────────────────────────────────────────────────────────

  async getOverview(fromS: string, toS: string, storeId: string | null, tzS?: string) {
    const w = parseWindow(fromS, toS);
    const tz = safeTimezone(tzS);
    const prevW = previousWindow(w);
    const yoyW = yearAgoWindow(w);

    const [current, previous, yearAgo] = await Promise.all([
      this.kpis(w, storeId),
      this.kpis(prevW, storeId),
      this.kpis(yoyW, storeId),
    ]);

    // Per-store revenue (current + previous) → best / top growth / declining.
    const { where, params } = this.win(w, storeId);
    const perStore = await this.q(
      `SELECT s.store_id, st.name, COALESCE(SUM(s.total_minor_units),0) AS revenue
         FROM sales s JOIN stores st ON st.id::text = s.store_id
        WHERE ${where} GROUP BY s.store_id, st.name`,
      params,
    );
    const prevQ = this.win(prevW, storeId);
    const perStorePrev = await this.q(
      `SELECT s.store_id, COALESCE(SUM(s.total_minor_units),0) AS revenue
         FROM sales s WHERE ${prevQ.where} GROUP BY s.store_id`,
      prevQ.params,
    );
    const prevBy = new Map(perStorePrev.map((r: any) => [r.store_id, num(r.revenue)]));
    const stores = perStore.map((r: any) => ({
      storeId: r.store_id,
      name: r.name,
      revenueMinorUnits: num(r.revenue),
      growthPct: growthPct(num(r.revenue), prevBy.get(r.store_id) ?? 0),
    }));
    const byRevenue = [...stores].sort((a, b) => b.revenueMinorUnits - a.revenueMinorUnits);
    const withGrowth = stores.filter((s) => s.growthPct !== null);
    const byGrowth = [...withGrowth].sort((a, b) => (b.growthPct ?? 0) - (a.growthPct ?? 0));
    const declining = byGrowth.filter((s) => (s.growthPct ?? 0) < 0);

    const [topProduct] = await this.q(
      `SELECT li.ean, MAX(li.product_name) AS name, SUM(li.quantity) AS qty,
              SUM(li.line_total_minor_units) AS revenue
         FROM sale_line_items li JOIN sales s ON s.id = li.sale_id
        WHERE ${where} GROUP BY li.ean ORDER BY qty DESC, revenue DESC LIMIT 1`,
      params,
    );

    const catParams = [...params];
    const [topCategory] = await this.q(
      `SELECT COALESCE(pc.name, 'Sans catégorie') AS name,
              SUM(li.line_total_minor_units) AS revenue
         FROM sale_line_items li
         JOIN sales s ON s.id = li.sale_id
         LEFT JOIN products p ON p.id::text = li.product_id
         LEFT JOIN product_categories pc ON pc.id::text = p.category_id
        WHERE ${where} GROUP BY 1 ORDER BY revenue DESC LIMIT 1`,
      catParams,
    );

    const hourParams = [tz, ...params];
    // $1 is tz, window params shift by 1.
    const hourWhere = where.replace(/\$(\d+)/g, (_m, n) => `$${Number(n) + 1}`);
    const [bestHour] = await this.q(
      `SELECT EXTRACT(HOUR FROM s.created_at AT TIME ZONE $1)::int AS hour,
              COALESCE(SUM(s.total_minor_units),0) AS revenue
         FROM sales s WHERE ${hourWhere} GROUP BY 1 ORDER BY revenue DESC LIMIT 1`,
      hourParams,
    );

    // Points de vente ouverts (session POS active) — instantané temps réel.
    const openParams: any[] = [];
    let openWhere = `ps.is_active = true AND ps.closed_at IS NULL`;
    if (storeId) {
      openParams.push(storeId);
      openWhere += ` AND ps.store_id = $1`;
    }
    const [open] = await this.q(
      `SELECT COUNT(DISTINCT ps.store_id) AS count FROM pos_sessions ps WHERE ${openWhere}`,
      openParams,
    );

    const totalStoresParams: any[] = [];
    let totalStoresWhere = `st.is_active = true AND st.is_archived = false`;
    if (storeId) {
      totalStoresParams.push(storeId);
      totalStoresWhere += ` AND st.id::text = $1`;
    }
    const [totalStores] = await this.q(
      `SELECT COUNT(*) AS count FROM stores st WHERE ${totalStoresWhere}`,
      totalStoresParams,
    );
    const storeCount = num(totalStores?.count);

    return {
      scope: storeId ? { type: 'store', storeId } : { type: 'network' },
      period: { from: w.from.toISOString(), to: w.to.toISOString(), timezone: tz },
      kpis: current,
      previousPeriod: {
        window: { from: prevW.from.toISOString(), to: prevW.to.toISOString() },
        kpis: previous,
        revenueGrowthPct: growthPct(current.revenueMinorUnits, previous.revenueMinorUnits),
        ticketsGrowthPct: growthPct(current.tickets, previous.tickets),
      },
      yearAgo: {
        window: { from: yoyW.from.toISOString(), to: yoyW.to.toISOString() },
        kpis: yearAgo,
        revenueGrowthPct: growthPct(current.revenueMinorUnits, yearAgo.revenueMinorUnits),
      },
      network: {
        totalStores: storeCount,
        openStores: num(open?.count),
        avgRevenuePerActiveStoreMinorUnits: current.activeStores
          ? Math.round(current.revenueMinorUnits / current.activeStores)
          : null,
        bestStore: byRevenue[0] ?? null,
        topGrowthStore: byGrowth[0] ?? null,
        decliningStore: declining.length ? declining[declining.length - 1] : null,
      },
      topProduct: topProduct
        ? {
            ean: topProduct.ean,
            name: topProduct.name,
            quantity: num(topProduct.qty),
            revenueMinorUnits: num(topProduct.revenue),
          }
        : null,
      topCategory: topCategory
        ? { name: topCategory.name, revenueMinorUnits: num(topCategory.revenue) }
        : null,
      bestHour: bestHour
        ? { hour: num(bestHour.hour), revenueMinorUnits: num(bestHour.revenue) }
        : null,
      generatedAt: new Date().toISOString(),
    };
  }

  // ── Fenêtres fixes de CA (jour, hier, semaine, mois, semestre, année) ──────

  async getRevenueWindows(storeId: string | null, tzS?: string) {
    const tz = safeTimezone(tzS);
    const params: any[] = [tz];
    let storeFilter = '';
    if (storeId) {
      params.push(storeId);
      storeFilter = ` AND s.store_id = $2`;
    }
    // One scan since Jan 1 of previous year; FILTER buckets computed in tz.
    const [row] = await this.q(
      `WITH loc AS (
         SELECT s.total_minor_units AS total, (s.created_at AT TIME ZONE $1) AS lts
           FROM sales s
          WHERE s.status = 'completed'
            AND s.created_at >= (date_trunc('year', now() AT TIME ZONE $1) - interval '1 year') AT TIME ZONE $1
            ${storeFilter}
       ), n AS (SELECT now() AT TIME ZONE $1 AS lnow)
       SELECT
         COALESCE(SUM(total) FILTER (WHERE lts::date = (SELECT lnow FROM n)::date), 0) AS today,
         COALESCE(SUM(total) FILTER (WHERE lts::date = ((SELECT lnow FROM n) - interval '1 day')::date), 0) AS yesterday,
         COALESCE(SUM(total) FILTER (WHERE lts >= date_trunc('week', (SELECT lnow FROM n)) AND lts <= (SELECT lnow FROM n)), 0) AS week,
         COALESCE(SUM(total) FILTER (WHERE lts >= date_trunc('month', (SELECT lnow FROM n)) AND lts <= (SELECT lnow FROM n)), 0) AS month,
         COALESCE(SUM(total) FILTER (WHERE lts >= date_trunc('year', (SELECT lnow FROM n))
             + CASE WHEN EXTRACT(MONTH FROM (SELECT lnow FROM n)) >= 7 THEN interval '6 months' ELSE interval '0' END
           AND lts <= (SELECT lnow FROM n)), 0) AS semester,
         COALESCE(SUM(total) FILTER (WHERE lts >= date_trunc('year', (SELECT lnow FROM n)) AND lts <= (SELECT lnow FROM n)), 0) AS year
       FROM loc`,
      params,
    );
    return {
      timezone: tz,
      scope: storeId ? { type: 'store', storeId } : { type: 'network' },
      todayMinorUnits: num(row?.today),
      yesterdayMinorUnits: num(row?.yesterday),
      weekMinorUnits: num(row?.week),
      monthMinorUnits: num(row?.month),
      semesterMinorUnits: num(row?.semester),
      yearMinorUnits: num(row?.year),
      generatedAt: new Date().toISOString(),
    };
  }

  // ── Classement des points de vente ─────────────────────────────────────────

  async getStoreRanking(fromS: string, toS: string, storeId: string | null, sort?: string, tzS?: string) {
    const w = parseWindow(fromS, toS);
    const tz = safeTimezone(tzS);
    const prevW = previousWindow(w);

    const base = this.win(w, storeId, [tz]);
    const where = base.where;
    const params = base.params;

    const current = await this.q(
      `SELECT s.store_id, st.name, st.city,
              COALESCE(SUM(s.total_minor_units),0) AS revenue,
              COUNT(*) AS tickets,
              COALESCE(SUM(s.discount_total_minor_units),0) AS discount,
              COUNT(DISTINCT date_trunc('hour', s.created_at AT TIME ZONE $1)) AS active_hours
         FROM sales s JOIN stores st ON st.id::text = s.store_id
        WHERE ${where} GROUP BY s.store_id, st.name, st.city`,
      params,
    );

    const prevQ = this.win(prevW, storeId);
    const previous = await this.q(
      `SELECT s.store_id, COALESCE(SUM(s.total_minor_units),0) AS revenue
         FROM sales s WHERE ${prevQ.where} GROUP BY s.store_id`,
      prevQ.params,
    );

    const curNoTz = this.win(w, storeId);
    const items = await this.q(
      `SELECT s.store_id, COALESCE(SUM(li.quantity),0) AS qty
         FROM sale_line_items li JOIN sales s ON s.id = li.sale_id
        WHERE ${curNoTz.where} GROUP BY s.store_id`,
      curNoTz.params,
    );

    // Marge brute estimée sur le coût produit ACTUEL (les lignes ne snapshotent
    // pas le coût) — couverte uniquement par les produits au coût renseigné.
    const margins = await this.q(
      `SELECT s.store_id,
              COALESCE(SUM(CASE WHEN p.cost_minor_units IS NOT NULL
                THEN li.line_total_minor_units - p.cost_minor_units * li.quantity END),0) AS margin,
              COALESCE(SUM(CASE WHEN p.cost_minor_units IS NOT NULL
                THEN li.line_total_minor_units END),0) AS covered_revenue,
              COALESCE(SUM(li.line_total_minor_units),0) AS total_revenue
         FROM sale_line_items li
         JOIN sales s ON s.id = li.sale_id
         LEFT JOIN products p ON p.id::text = li.product_id
        WHERE ${curNoTz.where} GROUP BY s.store_id`,
      curNoTz.params,
    );

    const cnParams: any[] = [w.from.toISOString(), w.to.toISOString()];
    let cnWhere = `cn.created_at >= $1 AND cn.created_at < $2`;
    if (storeId) {
      cnParams.push(storeId);
      cnWhere += ` AND cn.store_id = $3`;
    }
    const refunds = await this.q(
      `SELECT cn.store_id, COUNT(*) AS count, COALESCE(SUM(cn.total_minor_units),0) AS amount
         FROM credit_notes cn WHERE ${cnWhere} GROUP BY cn.store_id`,
      cnParams,
    );

    const vParams: any[] = [w.from.toISOString(), w.to.toISOString()];
    let vWhere = `s.status = 'voided' AND s.created_at >= $1 AND s.created_at < $2`;
    if (storeId) {
      vParams.push(storeId);
      vWhere += ` AND s.store_id = $3`;
    }
    const cancellations = await this.q(
      `SELECT s.store_id, COUNT(*) AS count FROM sales s WHERE ${vWhere} GROUP BY s.store_id`,
      vParams,
    );

    const allowed: StoreSortKey[] = [
      'revenue', 'growth', 'avgTicket', 'tickets', 'items',
      'revenuePerHour', 'margin', 'discountRate', 'refundRate',
    ];
    const sortKey = allowed.includes(sort as StoreSortKey) ? (sort as StoreSortKey) : 'revenue';

    // Statut ouvert = session POS active à l'instant T (lecture seule).
    const openRows = await this.q(
      `SELECT DISTINCT ps.store_id FROM pos_sessions ps
        WHERE ps.is_active = true AND ps.closed_at IS NULL`,
      [],
    );
    const openSet = new Set(openRows.map((r: any) => r.store_id));
    const ranked = buildStoreRanking({ current, previous, items, margins, refunds, cancellations, sort: sortKey });
    for (const e of ranked) e.openNow = openSet.has(e.storeId);

    return {
      period: { from: w.from.toISOString(), to: w.to.toISOString(), timezone: tz },
      sort: sortKey,
      stores: ranked,
      generatedAt: new Date().toISOString(),
    };
  }

  // ── Fiche magasin ──────────────────────────────────────────────────────────

  async getStoreDetail(id: string, fromS: string, toS: string, tzS?: string) {
    const w = parseWindow(fromS, toS);
    const [store] = await this.q(
      `SELECT st.id, st.name, st.city, st.timezone, st.currency_code
         FROM stores st WHERE st.id::text = $1`,
      [id],
    );
    if (!store) throw new NotFoundException('Magasin introuvable');
    const tz = safeTimezone(tzS ?? store.timezone);
    const prevW = previousWindow(w);
    const yoyW = yearAgoWindow(w);

    const [current, previous, yearAgo] = await Promise.all([
      this.kpis(w, id),
      this.kpis(prevW, id),
      this.kpis(yoyW, id),
    ]);

    const base = this.win(w, id, [tz]);
    const daily = await this.q(
      `SELECT (s.created_at AT TIME ZONE $1)::date::text AS date,
              COALESCE(SUM(s.total_minor_units),0) AS revenue, COUNT(*) AS tickets
         FROM sales s WHERE ${base.where} GROUP BY 1 ORDER BY 1`,
      base.params,
    );
    const hourly = await this.q(
      `SELECT EXTRACT(HOUR FROM s.created_at AT TIME ZONE $1)::int AS hour,
              COALESCE(SUM(s.total_minor_units),0) AS revenue, COUNT(*) AS tickets
         FROM sales s WHERE ${base.where} GROUP BY 1 ORDER BY 1`,
      base.params,
    );

    const cur = this.win(w, id);
    const products = await this.q(
      `SELECT li.ean, MAX(li.product_name) AS name, SUM(li.quantity) AS qty,
              SUM(li.line_total_minor_units) AS revenue
         FROM sale_line_items li JOIN sales s ON s.id = li.sale_id
        WHERE ${cur.where} GROUP BY li.ean ORDER BY qty DESC`,
      cur.params,
    );
    const categories = await this.q(
      `SELECT COALESCE(pc.name, 'Sans catégorie') AS category,
              SUM(li.line_total_minor_units) AS revenue, SUM(li.quantity) AS qty
         FROM sale_line_items li
         JOIN sales s ON s.id = li.sale_id
         LEFT JOIN products p ON p.id::text = li.product_id
         LEFT JOIN product_categories pc ON pc.id::text = p.category_id
        WHERE ${cur.where} GROUP BY 1 ORDER BY revenue DESC`,
      cur.params,
    );
    const prevCats = await this.q(
      `SELECT COALESCE(pc.name, 'Sans catégorie') AS category,
              SUM(li.line_total_minor_units) AS revenue
         FROM sale_line_items li
         JOIN sales s ON s.id = li.sale_id
         LEFT JOIN products p ON p.id::text = li.product_id
         LEFT JOIN product_categories pc ON pc.id::text = p.category_id
        WHERE ${this.win(prevW, id).where} GROUP BY 1`,
      this.win(prevW, id).params,
    );
    const prevCatBy = new Map(prevCats.map((r: any) => [r.category, num(r.revenue)]));

    // Ruptures actuelles (lecture seule) — produits actifs à stock 0.
    const [stockouts] = await this.q(
      `SELECT COUNT(*) AS count FROM products p
        WHERE p.store_id = $1 AND p.is_active = true AND p.stock_quantity <= 0`,
      [id],
    );

    // Rang réseau (CA période) — position du magasin parmi tous les magasins.
    const netWin = this.win(w, null);
    const ranking = await this.q(
      `SELECT s.store_id, COALESCE(SUM(s.total_minor_units),0) AS revenue
         FROM sales s WHERE ${netWin.where} GROUP BY s.store_id ORDER BY revenue DESC`,
      netWin.params,
    );
    const rankIdx = ranking.findIndex((r: any) => r.store_id === id);
    const prevNetWin = this.win(prevW, null);
    const prevRanking = await this.q(
      `SELECT s.store_id, COALESCE(SUM(s.total_minor_units),0) AS revenue
         FROM sales s WHERE ${prevNetWin.where} GROUP BY s.store_id ORDER BY revenue DESC`,
      prevNetWin.params,
    );
    const prevRankIdx = prevRanking.findIndex((r: any) => r.store_id === id);

    const bestDay = daily.reduce(
      (best: any, d: any) => (best === null || num(d.revenue) > num(best.revenue) ? d : best),
      null,
    );

    return {
      store: {
        id: store.id,
        name: store.name,
        city: store.city ?? null,
        timezone: tz,
        currencyCode: store.currency_code,
      },
      period: { from: w.from.toISOString(), to: w.to.toISOString(), timezone: tz },
      kpis: current,
      previousPeriod: {
        kpis: previous,
        revenueGrowthPct: growthPct(current.revenueMinorUnits, previous.revenueMinorUnits),
      },
      yearAgo: {
        kpis: yearAgo,
        revenueGrowthPct: growthPct(current.revenueMinorUnits, yearAgo.revenueMinorUnits),
      },
      dailySeries: daily.map((d: any) => ({
        date: d.date,
        revenueMinorUnits: num(d.revenue),
        tickets: num(d.tickets),
      })),
      hourly: hourly.map((h: any) => ({
        hour: num(h.hour),
        revenueMinorUnits: num(h.revenue),
        tickets: num(h.tickets),
      })),
      bestDay: bestDay
        ? { date: bestDay.date, revenueMinorUnits: num(bestDay.revenue) }
        : null,
      topProducts: products.slice(0, 10).map((p: any) => ({
        ean: p.ean,
        name: p.name,
        quantity: num(p.qty),
        revenueMinorUnits: num(p.revenue),
      })),
      flopProducts: [...products]
        .reverse()
        .slice(0, 10)
        .map((p: any) => ({
          ean: p.ean,
          name: p.name,
          quantity: num(p.qty),
          revenueMinorUnits: num(p.revenue),
        })),
      categories: categories.map((c: any) => ({
        category: c.category,
        revenueMinorUnits: num(c.revenue),
        quantity: num(c.qty),
        previousRevenueMinorUnits: prevCatBy.get(c.category) ?? 0,
        growthPct: growthPct(num(c.revenue), prevCatBy.get(c.category) ?? 0),
      })),
      currentStockouts: num(stockouts?.count),
      networkRank: rankIdx >= 0 ? { position: rankIdx + 1, total: ranking.length } : null,
      previousNetworkRank:
        prevRankIdx >= 0 ? { position: prevRankIdx + 1, total: prevRanking.length } : null,
      generatedAt: new Date().toISOString(),
    };
  }

  // ── Recherche + classements produits (identité réseau = EAN) ───────────────

  async searchProducts(opts: {
    from: string;
    to: string;
    storeId: string | null;
    q?: string;
    categoryId?: string;
    brand?: string;
    supplierId?: string;
    sort?: string;
    limit?: number;
    offset?: number;
  }) {
    const w = parseWindow(opts.from, opts.to);
    const prevW = previousWindow(w);
    const limit = Math.min(Math.max(Number(opts.limit) || 25, 1), 100);
    const offset = Math.max(Number(opts.offset) || 0, 0);

    const cur = this.win(w, opts.storeId);
    const params = [...cur.params];
    let filters = '';
    if (opts.q) {
      params.push(`%${opts.q}%`, opts.q);
      filters += ` AND (li.product_name ILIKE $${params.length - 1} OR li.ean = $${params.length}
                        OR pb.name ILIKE $${params.length - 1} OR p.variant_name ILIKE $${params.length - 1})`;
    }
    if (opts.categoryId) {
      params.push(opts.categoryId);
      filters += ` AND p.category_id = $${params.length}`;
    }
    if (opts.brand) {
      params.push(`%${opts.brand}%`);
      filters += ` AND pb.name ILIKE $${params.length}`;
    }
    if (opts.supplierId) {
      params.push(opts.supplierId);
      filters += ` AND p.supplier_id::text = $${params.length}`;
    }

    const sortMap: Record<string, string> = {
      qty: 'qty DESC',
      revenue: 'revenue DESC',
      qty_asc: 'qty ASC',
      revenue_asc: 'revenue ASC',
    };
    const orderBy = sortMap[opts.sort ?? ''] ?? 'qty DESC';

    params.push(limit, offset);
    const rows = await this.q(
      `SELECT li.ean, MAX(li.product_name) AS name,
              SUM(li.quantity) AS qty,
              SUM(li.line_total_minor_units) AS revenue,
              COUNT(DISTINCT s.store_id) AS store_count,
              MAX(pb.name) AS brand,
              MAX(p.image_url) AS image_url,
              MAX(pc.name) AS category
         FROM sale_line_items li
         JOIN sales s ON s.id = li.sale_id
         LEFT JOIN products p ON p.id::text = li.product_id
         LEFT JOIN brands pb ON pb.id::text = p.brand_id::text
         LEFT JOIN product_categories pc ON pc.id::text = p.category_id
        WHERE ${cur.where} ${filters}
        GROUP BY li.ean
        ORDER BY ${orderBy}, li.ean
        LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );

    // Previous-period quantities for the returned EANs (progression réelle).
    const eans = rows.map((r: any) => r.ean);
    let prevBy = new Map<string, { qty: number; revenue: number }>();
    if (eans.length) {
      const prevQ = this.win(prevW, opts.storeId);
      const pParams = [...prevQ.params, eans];
      const prev = await this.q(
        `SELECT li.ean, SUM(li.quantity) AS qty, SUM(li.line_total_minor_units) AS revenue
           FROM sale_line_items li JOIN sales s ON s.id = li.sale_id
          WHERE ${prevQ.where} AND li.ean = ANY($${pParams.length})
          GROUP BY li.ean`,
        pParams,
      );
      prevBy = new Map(prev.map((r: any) => [r.ean, { qty: num(r.qty), revenue: num(r.revenue) }]));
    }

    return {
      period: { from: w.from.toISOString(), to: w.to.toISOString() },
      products: rows.map((r: any) => {
        const prev = prevBy.get(r.ean);
        return {
          ean: r.ean,
          name: r.name,
          brand: r.brand ?? null,
          category: r.category ?? null,
          imageUrl: r.image_url ?? null,
          quantity: num(r.qty),
          revenueMinorUnits: num(r.revenue),
          storeCount: num(r.store_count),
          previousQuantity: prev?.qty ?? 0,
          quantityGrowthPct: growthPct(num(r.qty), prev?.qty ?? 0),
          revenueGrowthPct: growthPct(num(r.revenue), prev?.revenue ?? 0),
        };
      }),
      pagination: { limit, offset, count: rows.length },
      generatedAt: new Date().toISOString(),
    };
  }

  /** Catalogue (référentiel produits) — recherche même sans vente sur la période. */
  async searchCatalog(opts: { q: string; storeId: string | null; limit?: number }) {
    const limit = Math.min(Math.max(Number(opts.limit) || 20, 1), 50);
    const params: any[] = [`%${opts.q}%`, opts.q];
    let storeFilter = '';
    if (opts.storeId) {
      params.push(opts.storeId);
      storeFilter = ` AND p.store_id = $${params.length}`;
    }
    params.push(limit);
    const rows = await this.q(
      `SELECT p.ean, MAX(p.name) AS name, MAX(pb.name) AS brand,
              MAX(p.image_url) AS image_url, MAX(pc.name) AS category,
              SUM(p.stock_quantity) AS stock, COUNT(DISTINCT p.store_id) AS store_count
         FROM products p
         LEFT JOIN brands pb ON pb.id::text = p.brand_id::text
         LEFT JOIN product_categories pc ON pc.id::text = p.category_id
        WHERE p.is_active = true
          AND (p.name ILIKE $1 OR p.ean = $2 OR pb.name ILIKE $1 OR p.variant_name ILIKE $1)
          ${storeFilter}
        GROUP BY p.ean ORDER BY MAX(p.name) LIMIT $${params.length}`,
      params,
    );
    return rows.map((r: any) => ({
      ean: r.ean,
      name: r.name,
      brand: r.brand ?? null,
      category: r.category ?? null,
      imageUrl: r.image_url ?? null,
      stockQuantity: num(r.stock),
      storeCount: num(r.store_count),
    }));
  }

  // ── Fiche produit (agrégée par EAN sur la portée) ──────────────────────────

  async getProductDetail(ean: string, fromS: string, toS: string, storeId: string | null, tzS?: string) {
    const w = parseWindow(fromS, toS);
    const tz = safeTimezone(tzS);
    const prevW = previousWindow(w);

    const infoParams: any[] = [ean];
    let infoStore = '';
    if (storeId) {
      infoParams.push(storeId);
      infoStore = ` AND p.store_id = $2`;
    }
    const [info] = await this.q(
      `SELECT p.ean, MAX(p.name) AS name, MAX(pb.name) AS brand,
              MAX(p.image_url) AS image_url, MAX(pc.name) AS category,
              MIN(p.price_minor_units) AS price_min,
              MAX(p.price_minor_units) AS price_max,
              SUM(p.stock_quantity) AS stock,
              COUNT(*) AS catalog_stores
         FROM products p
         LEFT JOIN brands pb ON pb.id::text = p.brand_id::text
         LEFT JOIN product_categories pc ON pc.id::text = p.category_id
        WHERE p.ean = $1 ${infoStore}
        GROUP BY p.ean`,
      infoParams,
    );
    if (!info) throw new NotFoundException('Produit introuvable');

    const cur = this.win(w, storeId);
    const lineFilter = (whereFrag: string, base: any[]) => {
      const p = [...base, ean];
      return { where: `${whereFrag} AND li.ean = $${p.length}`, params: p };
    };
    const curLi = lineFilter(cur.where, cur.params);

    const [totals] = await this.q(
      `SELECT SUM(li.quantity) AS qty, SUM(li.line_total_minor_units) AS revenue,
              COUNT(DISTINCT s.id) AS tickets, COUNT(DISTINCT s.store_id) AS store_count
         FROM sale_line_items li JOIN sales s ON s.id = li.sale_id
        WHERE ${curLi.where}`,
      curLi.params,
    );
    const prevQ = this.win(prevW, storeId);
    const prevLi = lineFilter(prevQ.where, prevQ.params);
    const [prevTotals] = await this.q(
      `SELECT SUM(li.quantity) AS qty, SUM(li.line_total_minor_units) AS revenue
         FROM sale_line_items li JOIN sales s ON s.id = li.sale_id
        WHERE ${prevLi.where}`,
      prevLi.params,
    );

    const perStore = await this.q(
      `SELECT s.store_id, st.name, SUM(li.quantity) AS qty, SUM(li.line_total_minor_units) AS revenue
         FROM sale_line_items li
         JOIN sales s ON s.id = li.sale_id
         JOIN stores st ON st.id::text = s.store_id
        WHERE ${curLi.where}
        GROUP BY s.store_id, st.name ORDER BY qty DESC`,
      curLi.params,
    );

    const tzCur = this.win(w, storeId, [tz]);
    const tzLi = lineFilter(tzCur.where, tzCur.params);
    const daily = await this.q(
      `SELECT (s.created_at AT TIME ZONE $1)::date::text AS date, SUM(li.quantity) AS qty,
              SUM(li.line_total_minor_units) AS revenue
         FROM sale_line_items li JOIN sales s ON s.id = li.sale_id
        WHERE ${tzLi.where} GROUP BY 1 ORDER BY 1`,
      tzLi.params,
    );
    const hourlyRows = await this.q(
      `SELECT EXTRACT(HOUR FROM s.created_at AT TIME ZONE $1)::int AS hour, SUM(li.quantity) AS qty
         FROM sale_line_items li JOIN sales s ON s.id = li.sale_id
        WHERE ${tzLi.where} GROUP BY 1 ORDER BY 1`,
      tzLi.params,
    );
    const dowRows = await this.q(
      `SELECT EXTRACT(ISODOW FROM s.created_at AT TIME ZONE $1)::int AS dow, SUM(li.quantity) AS qty
         FROM sale_line_items li JOIN sales s ON s.id = li.sale_id
        WHERE ${tzLi.where} GROUP BY 1 ORDER BY 1`,
      tzLi.params,
    );

    // Panier moyen des tickets contenant le produit.
    const [basket] = await this.q(
      `SELECT AVG(s.total_minor_units) AS avg_basket
         FROM sales s
        WHERE ${cur.where}
          AND EXISTS (SELECT 1 FROM sale_line_items li WHERE li.sale_id = s.id AND li.ean = $${cur.params.length + 1})`,
      [...cur.params, ean],
    );

    // Produits fréquemment achetés avec lui (co-occurrence même ticket).
    const coParams = [...cur.params, ean];
    const coPurchased = await this.q(
      `SELECT li2.ean, MAX(li2.product_name) AS name, COUNT(DISTINCT s.id) AS together
         FROM sales s
         JOIN sale_line_items li1 ON li1.sale_id = s.id AND li1.ean = $${coParams.length}
         JOIN sale_line_items li2 ON li2.sale_id = s.id AND li2.ean <> li1.ean
        WHERE ${cur.where}
        GROUP BY li2.ean ORDER BY together DESC LIMIT 5`,
      coParams,
    );

    // Rang dans sa catégorie (par quantité, sur la portée/période).
    let categoryRank: { position: number; total: number } | null = null;
    if (info.category) {
      const catParams = [...cur.params, info.category];
      const catRows = await this.q(
        `SELECT li.ean, SUM(li.quantity) AS qty
           FROM sale_line_items li
           JOIN sales s ON s.id = li.sale_id
           LEFT JOIN products p ON p.id::text = li.product_id
           LEFT JOIN product_categories pc ON pc.id::text = p.category_id
          WHERE ${cur.where} AND pc.name = $${catParams.length}
          GROUP BY li.ean ORDER BY qty DESC`,
        catParams,
      );
      const idx = catRows.findIndex((r: any) => r.ean === ean);
      if (idx >= 0) categoryRank = { position: idx + 1, total: catRows.length };
    }

    // Variantes (P327 option A) : produits enfants du même parent, perf par variante.
    const varParams: any[] = [ean, w.from.toISOString(), w.to.toISOString()];
    let varStore = '';
    if (storeId) {
      varParams.push(storeId);
      varStore = ` AND s.store_id = $4`;
    }
    const variants = await this.q(
      `SELECT v.variant_name, v.ean, SUM(li.quantity) AS qty
         FROM products base
         JOIN products v ON v.parent_product_id = base.id
         LEFT JOIN sale_line_items li ON li.product_id = v.id::text
         LEFT JOIN sales s ON s.id = li.sale_id AND s.status = 'completed'
              AND s.created_at >= $2 AND s.created_at < $3 ${varStore}
        WHERE base.ean = $1
        GROUP BY v.variant_name, v.ean ORDER BY qty DESC NULLS LAST`,
      varParams,
    );

    const qty = num(totals?.qty);
    const spanDays = Math.max(1, Math.round((w.to.getTime() - w.from.getTime()) / 86400000));
    const storesRanked = perStore.map((r: any) => ({
      storeId: r.store_id,
      name: r.name,
      quantity: num(r.qty),
      revenueMinorUnits: num(r.revenue),
    }));

    return {
      product: {
        ean: info.ean,
        name: info.name,
        brand: info.brand ?? null,
        category: info.category ?? null,
        imageUrl: info.image_url ?? null,
        priceMinorUnits:
          num(info.price_min) === num(info.price_max)
            ? num(info.price_min)
            : null,
        priceRangeMinorUnits: { min: num(info.price_min), max: num(info.price_max) },
        currentStockQuantity: num(info.stock),
        catalogStoreCount: num(info.catalog_stores),
      },
      period: { from: w.from.toISOString(), to: w.to.toISOString(), timezone: tz },
      quantity: qty,
      revenueMinorUnits: num(totals?.revenue),
      ticketCount: num(totals?.tickets),
      storeCount: num(totals?.store_count),
      avgBasketWithProductMinorUnits:
        basket?.avg_basket != null ? Math.round(num(basket.avg_basket)) : null,
      avgDailyQuantity: Math.round((qty / spanDays) * 100) / 100,
      previousPeriod: {
        quantity: num(prevTotals?.qty),
        revenueMinorUnits: num(prevTotals?.revenue),
        quantityGrowthPct: growthPct(qty, num(prevTotals?.qty)),
        revenueGrowthPct: growthPct(num(totals?.revenue), num(prevTotals?.revenue)),
      },
      perStore: storesRanked,
      bestStore: storesRanked[0] ?? null,
      worstStore: storesRanked.length > 1 ? storesRanked[storesRanked.length - 1] : null,
      dailySeries: daily.map((d: any) => ({
        date: d.date,
        quantity: num(d.qty),
        revenueMinorUnits: num(d.revenue),
      })),
      hourly: hourlyRows.map((h: any) => ({ hour: num(h.hour), quantity: num(h.qty) })),
      byDayOfWeek: dowRows.map((d: any) => ({ isoDow: num(d.dow), quantity: num(d.qty) })),
      coPurchased: coPurchased.map((c: any) => ({
        ean: c.ean,
        name: c.name,
        ticketsTogether: num(c.together),
      })),
      categoryRank,
      variants: variants
        .filter((v: any) => v.variant_name !== null || v.ean)
        .map((v: any) => ({
          label: v.variant_name ?? v.ean,
          ean: v.ean,
          quantity: num(v.qty),
        })),
      // Historique des ruptures : aucune table d'historique de stock en base.
      stockoutHistory: null,
      generatedAt: new Date().toISOString(),
    };
  }

  // ── Catégories ─────────────────────────────────────────────────────────────

  async getCategories(fromS: string, toS: string, storeId: string | null) {
    const w = parseWindow(fromS, toS);
    const prevW = previousWindow(w);
    const cur = this.win(w, storeId);
    const prev = this.win(prevW, storeId);

    const catSelect = `COALESCE(pc.name, 'Sans catégorie')`;
    const joins = `FROM sale_line_items li
         JOIN sales s ON s.id = li.sale_id
         LEFT JOIN products p ON p.id::text = li.product_id
         LEFT JOIN product_categories pc ON pc.id::text = p.category_id`;

    const [current, previous, topStores, topProducts] = await Promise.all([
      this.q(
        `SELECT ${catSelect} AS category, SUM(li.line_total_minor_units) AS revenue,
                SUM(li.quantity) AS qty ${joins} WHERE ${cur.where} GROUP BY 1`,
        cur.params,
      ),
      this.q(
        `SELECT ${catSelect} AS category, SUM(li.line_total_minor_units) AS revenue
           ${joins} WHERE ${prev.where} GROUP BY 1`,
        prev.params,
      ),
      this.q(
        `SELECT category, store_id, store_name, revenue,
                ROW_NUMBER() OVER (PARTITION BY category ORDER BY revenue DESC) AS rn
           FROM (SELECT ${catSelect} AS category, s.store_id, st.name AS store_name,
                        SUM(li.line_total_minor_units) AS revenue
                   ${joins} JOIN stores st ON st.id::text = s.store_id
                  WHERE ${cur.where} GROUP BY 1, s.store_id, st.name) x`,
        cur.params,
      ),
      this.q(
        `SELECT * FROM (
           SELECT category, ean, name, qty,
                  ROW_NUMBER() OVER (PARTITION BY category ORDER BY qty DESC) AS rn
             FROM (SELECT ${catSelect} AS category, li.ean, MAX(li.product_name) AS name,
                          SUM(li.quantity) AS qty
                     ${joins} WHERE ${cur.where} GROUP BY 1, li.ean) x
         ) y WHERE y.rn <= 3`,
        cur.params,
      ),
    ]);

    return {
      period: { from: w.from.toISOString(), to: w.to.toISOString() },
      categories: buildCategories({
        current,
        previous,
        topStores: topStores.filter((r: any) => num(r.rn) === 1),
        topProducts,
      }),
      generatedAt: new Date().toISOString(),
    };
  }

  // ── Carte thermique jour × heure ───────────────────────────────────────────

  async getHeatmap(fromS: string, toS: string, storeId: string | null, tzS?: string) {
    const w = parseWindow(fromS, toS);
    const tz = safeTimezone(tzS);
    const base = this.win(w, storeId, [tz]);
    const rows = await this.q(
      `SELECT EXTRACT(ISODOW FROM s.created_at AT TIME ZONE $1)::int AS dow,
              EXTRACT(HOUR FROM s.created_at AT TIME ZONE $1)::int AS hour,
              COALESCE(SUM(s.total_minor_units),0) AS revenue, COUNT(*) AS tickets
         FROM sales s WHERE ${base.where} GROUP BY 1, 2 ORDER BY 1, 2`,
      base.params,
    );
    return {
      period: { from: w.from.toISOString(), to: w.to.toISOString(), timezone: tz },
      cells: rows.map((r: any) => ({
        isoDow: num(r.dow),
        hour: num(r.hour),
        revenueMinorUnits: num(r.revenue),
        tickets: num(r.tickets),
      })),
      generatedAt: new Date().toISOString(),
    };
  }


  // ── Séries multi-magasins (P367) — une courbe par point de vente ───────────

  /**
   * Séries temporelles par magasin (bucket heure/jour/semaine/mois, fuseau
   * demandé), composantes brutes par point : CA, tickets, articles, remises,
   * avoirs, annulations, marge estimée. Zéro-rempli sur tout le domaine (0 =
   * « aucune vente » réel, jamais d'interpolation). Moyenne et total réseau
   * calculés sur TOUS les magasins actifs (pas seulement la sélection).
   */
  async getSeries(opts: {
    from: string;
    to: string;
    storeIds: string[];
    bucket?: string;
    tz?: string;
    includeNetwork?: boolean;
  }) {
    const w = parseWindow(opts.from, opts.to);
    const tz = safeTimezone(opts.tz);
    const bucket = (() => {
      try {
        return resolveBucket(w, opts.bucket);
      } catch (e: any) {
        throw new BadRequestException(e.message);
      }
    })();
    const storeIds = [...new Set(opts.storeIds)].filter(Boolean);
    if (!storeIds.length) throw new BadRequestException('storeIds requis');
    if (storeIds.length > MAX_SERIES_STORES) {
      throw new BadRequestException(`${MAX_SERIES_STORES} magasins maximum par comparaison`);
    }

    const STEP: Record<SeriesBucket, string> = {
      hour: '1 hour', day: '1 day', week: '1 week', month: '1 month',
    };
    const KEY = `to_char(date_trunc('${bucket}', s.created_at AT TIME ZONE $1), 'YYYY-MM-DD HH24:MI')`;

    // Domaine complet des buckets (heure locale) — borne MAX_SERIES_POINTS
    // déjà garantie par resolveBucket.
    const domainRows = await this.q(
      `SELECT to_char(gs, 'YYYY-MM-DD HH24:MI') AS t
         FROM generate_series(
           date_trunc('${bucket}', $2::timestamptz AT TIME ZONE $1),
           date_trunc('${bucket}', ($3::timestamptz - interval '1 second') AT TIME ZONE $1),
           interval '${STEP[bucket]}') gs`,
      [tz, w.from.toISOString(), w.to.toISOString()],
    );
    const domain = domainRows.map((r: any) => r.t);

    const base = [tz, w.from.toISOString(), w.to.toISOString(), storeIds];
    const salesRows = await this.q(
      `SELECT s.store_id, ${KEY} AS t,
              COALESCE(SUM(s.total_minor_units),0) AS revenue,
              COUNT(*) AS tickets,
              COALESCE(SUM(s.discount_total_minor_units),0) AS discount
         FROM sales s
        WHERE s.status = 'completed' AND s.created_at >= $2 AND s.created_at < $3
          AND s.store_id = ANY($4)
        GROUP BY s.store_id, 2`,
      base,
    );
    const itemRows = await this.q(
      `SELECT s.store_id, ${KEY} AS t,
              COALESCE(SUM(li.quantity),0) AS items,
              SUM(CASE WHEN p.cost_minor_units IS NOT NULL
                  THEN li.line_total_minor_units - p.cost_minor_units * li.quantity END) AS margin
         FROM sale_line_items li
         JOIN sales s ON s.id = li.sale_id
         LEFT JOIN products p ON p.id::text = li.product_id
        WHERE s.status = 'completed' AND s.created_at >= $2 AND s.created_at < $3
          AND s.store_id = ANY($4)
        GROUP BY s.store_id, 2`,
      base,
    );
    const refundRows = await this.q(
      `SELECT cn.store_id,
              to_char(date_trunc('${bucket}', cn.created_at AT TIME ZONE $1), 'YYYY-MM-DD HH24:MI') AS t,
              COUNT(*) AS refunds
         FROM credit_notes cn
        WHERE cn.created_at >= $2 AND cn.created_at < $3 AND cn.store_id = ANY($4)
        GROUP BY cn.store_id, 2`,
      base,
    );
    const voidRows = await this.q(
      `SELECT s.store_id, ${KEY} AS t, COUNT(*) AS cancellations
         FROM sales s
        WHERE s.status = 'voided' AND s.created_at >= $2 AND s.created_at < $3
          AND s.store_id = ANY($4)
        GROUP BY s.store_id, 2`,
      base,
    );

    const stores = await this.q(
      `SELECT st.id::text AS id, st.name, st.city FROM stores st WHERE st.id::text = ANY($1)`,
      [storeIds],
    );
    const nameBy = new Map(stores.map((r: any) => [r.id, r]));

    const byStore = new Map<string, Map<string, any>>();
    const cell = (storeId: string, t: string) => {
      let m = byStore.get(storeId);
      if (!m) { m = new Map(); byStore.set(storeId, m); }
      let c = m.get(t);
      if (!c) { c = { margin: null }; m.set(t, c); }
      return c;
    };
    for (const r of salesRows) Object.assign(cell(r.store_id, r.t), { revenue: r.revenue, tickets: r.tickets, discount: r.discount });
    for (const r of itemRows) Object.assign(cell(r.store_id, r.t), { items: r.items, margin: r.margin });
    for (const r of refundRows) Object.assign(cell(r.store_id, r.t), { refunds: r.refunds });
    for (const r of voidRows) Object.assign(cell(r.store_id, r.t), { cancellations: r.cancellations });

    const series = storeIds
      .filter((id) => nameBy.has(id))
      .map((id) => ({
        storeId: id,
        name: (nameBy.get(id) as any).name,
        city: (nameBy.get(id) as any).city ?? null,
        points: fillSeries(domain, byStore.get(id) ?? new Map()),
      }));

    // Moyenne + total réseau (tous magasins), même bucketisation.
    let network: { average: SeriesPointComponents[]; total: SeriesPointComponents[]; storeCount: number } | null = null;
    if (opts.includeNetwork) {
      const netRows = await this.q(
        `SELECT ${KEY} AS t,
                COALESCE(SUM(s.total_minor_units),0) AS revenue,
                COUNT(*) AS tickets,
                COALESCE(SUM(s.discount_total_minor_units),0) AS discount,
                COUNT(DISTINCT s.store_id) AS stores
           FROM sales s
          WHERE s.status = 'completed' AND s.created_at >= $2 AND s.created_at < $3
          GROUP BY 1`,
        [tz, w.from.toISOString(), w.to.toISOString()],
      );
      const [nStores] = await this.q(
        `SELECT COUNT(*) AS count FROM stores st WHERE st.is_active = true AND st.is_archived = false`,
        [],
      );
      const storeCount = Math.max(num(nStores?.count), 1);
      const totalMap = new Map(netRows.map((r: any) => [r.t, { revenue: r.revenue, tickets: r.tickets, discount: r.discount }]));
      const total = fillSeries(domain, totalMap as any);
      const average = total.map((pt) => ({
        ...pt,
        revenue: Math.round(pt.revenue / storeCount),
        tickets: Math.round((pt.tickets / storeCount) * 100) / 100,
        items: 0,
        discount: Math.round(pt.discount / storeCount),
        margin: null,
      }));
      network = { average, total, storeCount };
    }

    return {
      period: { from: w.from.toISOString(), to: w.to.toISOString(), timezone: tz },
      bucket,
      domain,
      series,
      network,
      // Horaires d'ouverture absents du modèle : impossible de distinguer
      // « magasin fermé » de « aucune vente » — le client l'affiche tel quel.
      openingHoursAvailable: false,
      generatedAt: new Date().toISOString(),
    };
  }

  // ── Matrice produits × magasins (P367) ─────────────────────────────────────

  /**
   * Produit (EAN) × magasin : quantité, CA, prix moyen vendu, tickets, rang du
   * produit dans chaque magasin + total réseau. Tri par un magasin donné ou
   * par le total de la sélection.
   */
  async getProductsMatrix(opts: {
    from: string;
    to: string;
    storeIds: string[];
    sortStoreId?: string;
    limit?: number;
    offset?: number;
  }) {
    const w = parseWindow(opts.from, opts.to);
    const storeIds = [...new Set(opts.storeIds)].filter(Boolean);
    if (!storeIds.length) throw new BadRequestException('storeIds requis');
    if (storeIds.length > MAX_SERIES_STORES) {
      throw new BadRequestException(`${MAX_SERIES_STORES} magasins maximum par comparaison`);
    }
    const limit = Math.min(Math.max(Number(opts.limit) || 30, 1), 100);
    const offset = Math.max(Number(opts.offset) || 0, 0);

    const params = [w.from.toISOString(), w.to.toISOString(), storeIds];
    const rows = await this.q(
      `SELECT s.store_id, li.ean, MAX(li.product_name) AS name,
              SUM(li.quantity) AS qty,
              SUM(li.line_total_minor_units) AS revenue,
              COUNT(DISTINCT s.id) AS tickets,
              ROW_NUMBER() OVER (PARTITION BY s.store_id ORDER BY SUM(li.quantity) DESC) AS rank
         FROM sale_line_items li
         JOIN sales s ON s.id = li.sale_id
        WHERE s.status = 'completed' AND s.created_at >= $1 AND s.created_at < $2
          AND s.store_id = ANY($3)
        GROUP BY s.store_id, li.ean`,
      params,
    );

    // Regroupe par EAN, trie par le magasin demandé ou le total sélection.
    const byEan = new Map<string, { ean: string; name: string; cells: Map<string, any>; totalQty: number }>();
    for (const r of rows) {
      let e = byEan.get(r.ean);
      if (!e) { e = { ean: r.ean, name: r.name, cells: new Map(), totalQty: 0 }; byEan.set(r.ean, e); }
      e.name = r.name ?? e.name;
      const qty = num(r.qty);
      e.cells.set(r.store_id, {
        quantity: qty,
        revenueMinorUnits: num(r.revenue),
        tickets: num(r.tickets),
        avgUnitPriceMinorUnits: qty ? Math.round(num(r.revenue) / qty) : null,
        rank: num(r.rank),
      });
      e.totalQty += qty;
    }
    const sortVal = (e: { cells: Map<string, any>; totalQty: number }) =>
      opts.sortStoreId ? (e.cells.get(opts.sortStoreId)?.quantity ?? 0) : e.totalQty;
    const all = [...byEan.values()].sort((a, b) => sortVal(b) - sortVal(a) || a.name.localeCompare(b.name));
    const page = all.slice(offset, offset + limit);

    // Total réseau (tous magasins) pour les EAN retournés.
    let networkBy = new Map<string, { qty: number; revenue: number }>();
    if (page.length) {
      const eans = page.map((e) => e.ean);
      const net = await this.q(
        `SELECT li.ean, SUM(li.quantity) AS qty, SUM(li.line_total_minor_units) AS revenue
           FROM sale_line_items li JOIN sales s ON s.id = li.sale_id
          WHERE s.status = 'completed' AND s.created_at >= $1 AND s.created_at < $2
            AND li.ean = ANY($3)
          GROUP BY li.ean`,
        [w.from.toISOString(), w.to.toISOString(), eans],
      );
      networkBy = new Map(net.map((r: any) => [r.ean, { qty: num(r.qty), revenue: num(r.revenue) }]));
    }

    const stores = await this.q(
      `SELECT st.id::text AS id, st.name FROM stores st WHERE st.id::text = ANY($1)`,
      [storeIds],
    );

    return {
      period: { from: w.from.toISOString(), to: w.to.toISOString() },
      stores: stores.map((r: any) => ({ storeId: r.id, name: r.name })),
      products: page.map((e) => ({
        ean: e.ean,
        name: e.name,
        totalQuantity: e.totalQty,
        network: networkBy.get(e.ean) ?? null,
        perStore: Object.fromEntries(
          storeIds.map((id) => [id, e.cells.get(id) ?? null]),
        ),
      })),
      pagination: { limit, offset, count: page.length, totalProducts: all.length },
      generatedAt: new Date().toISOString(),
    };
  }

  // ── Comparaison générique (périodes et/ou magasins) ────────────────────────

  private async side(label: string, fromS: string, toS: string, storeId: string | null, tz: string): Promise<CompareSide> {
    const w = parseWindow(fromS, toS);
    const kpis = await this.kpis(w, storeId);
    const base = this.win(w, storeId, [tz]);
    const daily = await this.q(
      `SELECT (s.created_at AT TIME ZONE $1)::date::text AS date,
              COALESCE(SUM(s.total_minor_units),0) AS revenue, COUNT(*) AS tickets
         FROM sales s WHERE ${base.where} GROUP BY 1 ORDER BY 1`,
      base.params,
    );
    const hourly = await this.q(
      `SELECT EXTRACT(HOUR FROM s.created_at AT TIME ZONE $1)::int AS hour,
              COALESCE(SUM(s.total_minor_units),0) AS revenue, COUNT(*) AS tickets
         FROM sales s WHERE ${base.where} GROUP BY 1 ORDER BY 1`,
      base.params,
    );
    return {
      label,
      window: { from: w.from.toISOString(), to: w.to.toISOString() },
      storeId,
      kpis,
      dailySeries: daily.map((d: any) => ({
        date: d.date,
        revenueMinorUnits: num(d.revenue),
        tickets: num(d.tickets),
      })),
      hourly: hourly.map((h: any) => ({
        hour: num(h.hour),
        revenueMinorUnits: num(h.revenue),
        tickets: num(h.tickets),
      })),
    };
  }

  async getCompare(opts: {
    aFrom: string;
    aTo: string;
    bFrom: string;
    bTo: string;
    storeA: string | null;
    storeB: string | null;
    tz?: string;
  }) {
    const tz = safeTimezone(opts.tz);
    const [a, b] = await Promise.all([
      this.side('A', opts.aFrom, opts.aTo, opts.storeA, tz),
      this.side('B', opts.bFrom, opts.bTo, opts.storeB, tz),
    ]);
    return {
      a,
      b,
      delta: buildCompareDelta(a.kpis, b.kpis),
      generatedAt: new Date().toISOString(),
    };
  }
}
