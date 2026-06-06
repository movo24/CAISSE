import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
import { AiLearningService } from './ai-learning.service';
import { ExternalContextService } from './external-context.service';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { SaleEntity } from '../../database/entities/sale.entity';
import { SaleLineItemEntity } from '../../database/entities/sale-line-item.entity';
import { ProductEntity } from '../../database/entities/product.entity';

/* ═══════════════════════════════════════════════════════════════
   SALES AI ENGINE — V1

   Architecture: DATA ENGINE first, LLM never invents signals.

   V1 capabilities:
   1. Product association detection (which products are bought together)
   2. Hourly sales pattern detection (when does each product sell best)
   3. Contextual upsell recommendations with confidence scoring
   4. Strategic silence (no recommendation if confidence < threshold)

   Rule: If signal is weak → say nothing. Never bluff.
   ═══════════════════════════════════════════════════════════════ */

// ── Types ──

export interface ProductAssociation {
  productA: string;
  productAName: string;
  productB: string;
  productBName: string;
  coOccurrences: number;
  totalTicketsA: number;
  attachmentRate: number;    // 0-1
  confidence: number;        // 0-1 (V4 multi-factor)
  marginBoost: number;       // Price of B in cents
  marginPercent: number;     // Margin % of product B
  estimatedCashImpact: number; // Estimated margin in cents per reco accepted
  stockPressure: 'overstock' | 'healthy' | 'low'; // Stock status of B
}

export interface HourlyPattern {
  hour: number;           // 0-23
  avgTickets: number;
  avgRevenue: number;     // cents
  avgBasket: number;      // cents
  topProducts: { productId: string; name: string; count: number }[];
  isRush: boolean;
}

export interface SalesRecommendation {
  type: 'upsell' | 'alert' | 'insight' | 'silence';
  message: string;
  why: string;
  confidence: number;     // 0-1
  impact: string;
  scope: string;          // e.g. "store_PAR001_17h-19h"
  actionability: 'immediate' | 'watch' | 'info';
  evidence: string[];
  productId?: string;
  productName?: string;
  suggestedProductId?: string;
  suggestedProductName?: string;
}

// ── Config V4 — Cash-oriented scoring ──

const MIN_TICKETS_FOR_ASSOCIATION = 100;
const MIN_COOCCURRENCE = 10;
const MIN_ATTACHMENT_RATE = 0.25;
const MIN_CONFIDENCE = 0.75;
const MIN_MARGIN_PERCENT = 10;
const MIN_STOCK_FOR_RECOMMEND = 3;
const OVERSTOCK_THRESHOLD = 50;          // Stock > 50 = overstock → push harder
const RUSH_THRESHOLD_MULTIPLIER = 1.5;

// ── V4 Scoring weights — CASH FIRST ──
const W_COOCCURRENCE = 0.30;  // Correlation (reduced — no longer king)
const W_MARGIN = 0.35;        // MARGIN IS KING — push what makes money
const W_STOCK_PRESSURE = 0.15; // Push overstock, block low stock
const W_TEMPORAL = 0.10;      // Time-of-day relevance
const W_CONSISTENCY = 0.10;   // Pattern stability

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes cache

@Injectable()
export class SalesAiService {
  private readonly logger = new Logger('SalesAI');
  private associationCache = new Map<string, { data: ProductAssociation[]; timestamp: number }>();
  private hourlyCache = new Map<string, { data: HourlyPattern[]; timestamp: number }>();

  constructor(
    @InjectRepository(SaleEntity) private readonly saleRepo: Repository<SaleEntity>,
    @InjectRepository(SaleLineItemEntity) private readonly lineRepo: Repository<SaleLineItemEntity>,
    @InjectRepository(ProductEntity) private readonly productRepo: Repository<ProductEntity>,
    private readonly dataSource: DataSource,
    @Inject(forwardRef(() => AiLearningService)) private readonly learning: AiLearningService,
    @Inject(forwardRef(() => ExternalContextService)) private readonly externalCtx: ExternalContextService,
  ) {}

  // ── 1. PRODUCT ASSOCIATIONS (cached 5 min) ──
  async computeAssociations(storeId: string, daysBack = 30): Promise<ProductAssociation[]> {
    // Check cache first — avoid recalculating on every request
    const cacheKey = `${storeId}:${daysBack}`;
    const cached = this.associationCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
      return cached.data;
    }

    // ── Pure SQL: compute co-occurrences in PostgreSQL (fast, no ORM overhead) ──
    const ticketCountResult = await this.dataSource.query(`
      SELECT COUNT(DISTINCT id) as cnt FROM sales
      WHERE store_id = $1 AND status = 'completed'
        AND created_at >= NOW() - INTERVAL '${daysBack} days'
    `, [storeId]);
    const totalTickets = parseInt(ticketCountResult[0]?.cnt || '0', 10);

    if (totalTickets < MIN_TICKETS_FOR_ASSOCIATION) {
      this.logger.log(`[AI] Only ${totalTickets} tickets (need ${MIN_TICKETS_FOR_ASSOCIATION}) — associations not reliable yet`);
      return [];
    }

    // Load product catalog for margin + stock data
    const allProducts = await this.productRepo.find({ where: { storeId } });
    const productCatalog = new Map(allProducts.map((p) => [p.id, p]));
    const productNames = new Map(allProducts.map((p) => [p.id, p.name]));
    const productPrices = new Map(allProducts.map((p) => [p.id, p.priceMinorUnits || 0]));
    const productCosts = new Map(allProducts.map((p) => [p.id, p.costMinorUnits || 0]));
    const productStocks = new Map(allProducts.map((p) => [p.id, p.stockQuantity || 0]));

    // Step 1: Pre-compute per-product ticket counts (fast, no correlated subquery)
    const productCountRows: any[] = await this.dataSource.query(`
      SELECT li.product_id as pid, COUNT(DISTINCT li.sale_id) as cnt
      FROM sale_line_items li
      JOIN sales s ON s.id = li.sale_id
      WHERE s.store_id = $1 AND s.status = 'completed'
        AND s.created_at >= NOW() - INTERVAL '${daysBack} days'
      GROUP BY li.product_id
    `, [storeId]);
    const productTicketCounts = new Map<string, number>();
    for (const r of productCountRows) {
      productTicketCounts.set(r.pid, parseInt(r.cnt, 10));
    }

    // Step 2: Co-occurrence via self-join (no correlated subquery)
    const coOccRows: any[] = await this.dataSource.query(`
      SELECT
        a.product_id as pid_a,
        b.product_id as pid_b,
        COUNT(DISTINCT a.sale_id) as co_count
      FROM sale_line_items a
      JOIN sale_line_items b ON a.sale_id = b.sale_id AND a.product_id < b.product_id
      JOIN sales s ON s.id = a.sale_id
      WHERE s.store_id = $1 AND s.status = 'completed'
        AND s.created_at >= NOW() - INTERVAL '${daysBack} days'
      GROUP BY a.product_id, b.product_id
      HAVING COUNT(DISTINCT a.sale_id) >= ${MIN_COOCCURRENCE}
      ORDER BY co_count DESC
      LIMIT 50
    `, [storeId]);

    // Build associations from SQL results
    const associations: ProductAssociation[] = [];

    for (const row of coOccRows) {
      const pidA = row.pid_a;
      const pidB = row.pid_b;
      const coOccurrences = parseInt(row.co_count, 10);
      const totalA = productTicketCounts.get(pidA) || 1;
      const totalB = productTicketCounts.get(pidB) || 1;

      const attachmentRateAB = coOccurrences / totalA;
      const attachmentRateBA = coOccurrences / totalB;

      // Use the higher attachment rate (A→B or B→A)
      const [mainPid, sugPid, rate, mainTickets] = attachmentRateAB >= attachmentRateBA
        ? [pidA, pidB, attachmentRateAB, totalA]
        : [pidB, pidA, attachmentRateBA, totalB];

      if (rate < MIN_ATTACHMENT_RATE) continue;

      // ── V4 Cash-oriented multi-factor scoring ──

      // 1. Co-occurrence strength (volume + rate)
      const coOccurrenceScore = Math.min(1, (rate / 0.5) * 0.6 + (mainTickets / 200) * 0.4);

      // 2. MARGIN IS KING — push what makes money
      const sugPrice = productPrices.get(sugPid) || 0;
      const sugCost = productCosts.get(sugPid) || 0;
      const marginPercent = sugPrice > 0 ? ((sugPrice - sugCost) / sugPrice) * 100 : 50;
      if (marginPercent < MIN_MARGIN_PERCENT) continue;
      const marginScore = Math.min(1, marginPercent / 70);

      // 3. Stock pressure
      const sugStock = productStocks.get(sugPid) || 0;
      if (sugStock < MIN_STOCK_FOR_RECOMMEND) continue;
      let stockPressureScore: number;
      if (sugStock >= OVERSTOCK_THRESHOLD) stockPressureScore = 1.0;
      else if (sugStock >= 20) stockPressureScore = 0.7;
      else stockPressureScore = 0.3;

      // 4. Temporal relevance
      const currentHour = new Date().getHours();
      let temporalScore = 0.5;
      if (currentHour >= 7 && currentHour <= 9) temporalScore = 0.8;
      if (currentHour >= 12 && currentHour <= 14) temporalScore = 0.9;
      if (currentHour >= 17 && currentHour <= 20) temporalScore = 0.7;

      // 5. Consistency
      const consistencyScore = Math.min(1, coOccurrences / 30);

      // ── FINAL SCORE ──
      const confidence =
        coOccurrenceScore * W_COOCCURRENCE +
        marginScore * W_MARGIN +
        stockPressureScore * W_STOCK_PRESSURE +
        temporalScore * W_TEMPORAL +
        consistencyScore * W_CONSISTENCY;

      const estimatedCashImpact = Math.round((marginPercent / 100) * sugPrice);

      associations.push({
        productA: mainPid,
        productAName: productNames.get(mainPid) || mainPid,
        productB: sugPid,
        productBName: productNames.get(sugPid) || sugPid,
        coOccurrences,
        totalTicketsA: mainTickets,
        attachmentRate: rate,
        confidence,
        marginBoost: sugPrice,
        marginPercent: Math.round(marginPercent),
        estimatedCashImpact,
        stockPressure: sugStock >= OVERSTOCK_THRESHOLD ? 'overstock' : sugStock >= 20 ? 'healthy' : 'low',
      });
    }

    // V4: Sort by estimated CASH IMPACT (confidence × margin in cents)
    // This ensures the AI pushes what makes the most money, not just what correlates
    associations.sort((a, b) => (b.confidence * b.estimatedCashImpact) - (a.confidence * a.estimatedCashImpact));

    this.logger.log(`[AI] Found ${associations.length} product associations from ${totalTickets} tickets`);

    // Cache result
    this.associationCache.set(cacheKey, { data: associations, timestamp: Date.now() });

    return associations;
  }

  // ── 2. HOURLY PATTERNS (cached 5 min) ──
  async computeHourlyPatterns(storeId: string, daysBack = 30): Promise<HourlyPattern[]> {
    const cacheKey = `hourly:${storeId}:${daysBack}`;
    const cached = this.hourlyCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
      return cached.data;
    }
    const result = await this.dataSource.query(`
      SELECT
        EXTRACT(HOUR FROM s.created_at) as hour,
        COUNT(DISTINCT s.id) as ticket_count,
        COALESCE(SUM(s.total_minor_units), 0) as total_revenue,
        COUNT(DISTINCT DATE(s.created_at)) as distinct_days
      FROM sales s
      WHERE s.store_id = $1
        AND s.status = 'completed'
        AND s.created_at >= NOW() - INTERVAL '${daysBack} days'
      GROUP BY EXTRACT(HOUR FROM s.created_at)
      ORDER BY hour
    `, [storeId]);

    if (result.length === 0) return [];

    const avgTicketsGlobal = result.reduce((s: number, r: any) => s + Number(r.ticket_count), 0) / result.length;

    const patterns: HourlyPattern[] = result.map((r: any) => {
      const days = Math.max(1, Number(r.distinct_days));
      const tickets = Number(r.ticket_count);
      const revenue = Number(r.total_revenue);
      return {
        hour: Number(r.hour),
        avgTickets: Math.round(tickets / days * 10) / 10,
        avgRevenue: Math.round(revenue / days),
        avgBasket: tickets > 0 ? Math.round(revenue / tickets) : 0,
        topProducts: [], // Will be filled separately if needed
        isRush: (tickets / days) > (avgTicketsGlobal / result.length * RUSH_THRESHOLD_MULTIPLIER),
      };
    });

    // Cache result
    this.hourlyCache.set(cacheKey, { data: patterns, timestamp: Date.now() });

    return patterns;
  }

  // ── 3. CONTEXTUAL RECOMMENDATIONS ──
  async getRecommendations(
    storeId: string,
    currentCart: { productId: string; name: string }[] = [],
  ): Promise<SalesRecommendation[]> {
    const recommendations: SalesRecommendation[] = [];

    // Get associations
    const associations = await this.computeAssociations(storeId);

    if (associations.length === 0) {
      return [{
        type: 'silence',
        message: 'Accumulation de données en cours',
        why: 'Pas assez de ventes pour générer des recommandations fiables',
        confidence: 0,
        impact: 'none',
        scope: storeId,
        actionability: 'info',
        evidence: [`< ${MIN_TICKETS_FOR_ASSOCIATION} tickets analysables`],
      }];
    }

    // V5: Get external context (weather + transport) — fail-safe
    let externalBoost = 0;
    const externalEvidence: string[] = [];
    try {
      const ctx = await this.externalCtx.getFullContext();
      if (ctx.weather.available) {
        externalBoost += ctx.weather.impactScore * 0.1; // Max ±0.06 impact on score
        if (ctx.weather.impactScore !== 0) {
          externalEvidence.push(`Météo: ${ctx.weather.description} (${ctx.weather.impactReason})`);
        }
      }
      if (ctx.transport.available) {
        externalBoost += ctx.transport.impactScore * 0.1;
        if (ctx.transport.hasDisruptions) {
          externalEvidence.push(`Transport: ${ctx.transport.impactReason}`);
        }
      }
    } catch {
      // External context unavailable → no boost, no penalty
    }

    // If cart has items → find upsell opportunities
    if (currentCart.length > 0) {
      const cartProductIds = new Set(currentCart.map((i) => i.productId));

      for (const assoc of associations) {
        // Product A is in cart, suggest B
        if (cartProductIds.has(assoc.productA) && !cartProductIds.has(assoc.productB)) {
          // V5: Skip blacklisted products
          const blacklisted = await this.learning.isBlacklisted(assoc.productB, storeId);
          if (blacklisted) continue;

          // Apply external context boost to confidence
          const adjustedConfidence = Math.min(1, assoc.confidence + externalBoost);

          if (adjustedConfidence >= MIN_CONFIDENCE) {
            recommendations.push({
              type: 'upsell',
              message: `Proposer ${assoc.productBName}`,
              why: `${Math.round(assoc.attachmentRate * 100)}% des clients prennent aussi ${assoc.productBName} (marge ${assoc.marginPercent}%${assoc.stockPressure === 'overstock' ? ' · surstock à écouler' : ''})`,
              confidence: adjustedConfidence,
              impact: `+${(assoc.estimatedCashImpact / 100).toFixed(2)}€ marge`,
              scope: storeId,
              actionability: 'immediate',
              evidence: [
                `${assoc.coOccurrences} co-achats observés`,
                `taux d'association ${Math.round(assoc.attachmentRate * 100)}%`,
                `sur ${assoc.totalTicketsA} tickets`,
                ...externalEvidence,
              ],
              productId: assoc.productA,
              productName: assoc.productAName,
              suggestedProductId: assoc.productB,
              suggestedProductName: assoc.productBName,
            });
          }
        }
      }
    }

    // General insights (no cart required)
    // Top association as general recommendation
    const topAssoc = associations[0];
    if (topAssoc && topAssoc.confidence >= MIN_CONFIDENCE) {
      recommendations.push({
        type: 'insight',
        message: `Association forte : ${topAssoc.productAName} + ${topAssoc.productBName}`,
        why: `${Math.round(topAssoc.attachmentRate * 100)}% d'attachement, ${topAssoc.coOccurrences} co-achats`,
        confidence: topAssoc.confidence,
        impact: `Mettre en avant près du comptoir`,
        scope: storeId,
        actionability: 'watch',
        evidence: [
          `${topAssoc.totalTicketsA} tickets analysés`,
          `confiance ${Math.round(topAssoc.confidence * 100)}%`,
        ],
      });
    }

    // Stock alerts for high-association products
    const products = await this.productRepo.find({ where: { storeId, isActive: true } });
    const stockMap = new Map(products.map((p) => [p.id, p]));

    for (const assoc of associations.slice(0, 5)) {
      const sugProduct = stockMap.get(assoc.productB);
      if (sugProduct && sugProduct.stockQuantity <= (sugProduct.stockAlertThreshold || 5)) {
        recommendations.push({
          type: 'alert',
          message: `Stock critique sur ${assoc.productBName} — produit souvent associé`,
          why: `Ce produit est vendu avec ${assoc.productAName} dans ${Math.round(assoc.attachmentRate * 100)}% des cas. Rupture = perte de CA.`,
          confidence: 0.9,
          impact: `Risque perte CA si rupture`,
          scope: storeId,
          actionability: 'immediate',
          evidence: [
            `stock actuel: ${sugProduct.stockQuantity}`,
            `seuil critique: ${sugProduct.stockAlertThreshold || 5}`,
            `association forte avec ${assoc.productAName}`,
          ],
          productId: assoc.productB,
          productName: assoc.productBName,
        });
      }
    }

    // Sort by confidence × actionability
    const actionPriority = { immediate: 3, watch: 2, info: 1 };
    recommendations.sort((a, b) =>
      (b.confidence * actionPriority[b.actionability]) -
      (a.confidence * actionPriority[a.actionability])
    );

    return recommendations;
  }

  // ── 4. STORE STATS SUMMARY ──
  async getStoreStats(storeId: string): Promise<{
    totalTickets: number;
    avgBasket: number;
    topProducts: { name: string; count: number; revenue: number }[];
    dataQuality: 'insufficient' | 'basic' | 'good' | 'excellent';
    aiReady: boolean;
  }> {
    const result = await this.dataSource.query(`
      SELECT
        COUNT(DISTINCT s.id) as tickets,
        COALESCE(AVG(s.total_minor_units), 0) as avg_basket,
        COALESCE(SUM(s.total_minor_units), 0) as total_revenue
      FROM sales s
      WHERE s.store_id = $1 AND s.status = 'completed'
    `, [storeId]);

    const tickets = Number(result[0]?.tickets || 0);
    const avgBasket = Math.round(Number(result[0]?.avg_basket || 0));

    // Top products
    const topResult = await this.dataSource.query(`
      SELECT
        li.product_name as name,
        SUM(li.quantity) as count,
        SUM(li.line_total_minor_units) as revenue
      FROM sale_line_items li
      JOIN sales s ON s.id = li.sale_id
      WHERE s.store_id = $1 AND s.status = 'completed'
      GROUP BY li.product_name
      ORDER BY count DESC
      LIMIT 10
    `, [storeId]);

    const topProducts = topResult.map((r: any) => ({
      name: r.name,
      count: Number(r.count),
      revenue: Number(r.revenue),
    }));

    let dataQuality: 'insufficient' | 'basic' | 'good' | 'excellent';
    if (tickets < 20) dataQuality = 'insufficient';
    else if (tickets < 100) dataQuality = 'basic';
    else if (tickets < 500) dataQuality = 'good';
    else dataQuality = 'excellent';

    return {
      totalTickets: tickets,
      avgBasket,
      topProducts,
      dataQuality,
      aiReady: tickets >= MIN_TICKETS_FOR_ASSOCIATION,
    };
  }
}
