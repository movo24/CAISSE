import { Injectable, Logger } from '@nestjs/common';
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
  productA: string;       // productId
  productAName: string;
  productB: string;       // productId
  productBName: string;
  coOccurrences: number;  // How many tickets contain both
  totalTicketsA: number;  // Total tickets containing A
  attachmentRate: number; // coOccurrences / totalTicketsA (0-1)
  confidence: number;     // Overall confidence score (0-1)
  marginBoost: number;    // Extra margin from B in cents
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

// ── Config ──

const MIN_TICKETS_FOR_ASSOCIATION = 20;   // Need at least 20 tickets to find patterns
const MIN_COOCCURRENCE = 3;               // Product pair must appear in 3+ tickets
const MIN_ATTACHMENT_RATE = 0.15;         // 15% minimum attachment rate
const MIN_CONFIDENCE = 0.6;              // Below this → silence
const RUSH_THRESHOLD_MULTIPLIER = 1.5;   // 1.5x average = rush hour

@Injectable()
export class SalesAiService {
  private readonly logger = new Logger('SalesAI');

  constructor(
    @InjectRepository(SaleEntity) private readonly saleRepo: Repository<SaleEntity>,
    @InjectRepository(SaleLineItemEntity) private readonly lineRepo: Repository<SaleLineItemEntity>,
    @InjectRepository(ProductEntity) private readonly productRepo: Repository<ProductEntity>,
    private readonly dataSource: DataSource,
  ) {}

  // ── 1. PRODUCT ASSOCIATIONS ──
  // Find which products are frequently bought together
  async computeAssociations(storeId: string, daysBack = 30): Promise<ProductAssociation[]> {
    // Get all completed sales with line items for this store
    const sales = await this.saleRepo
      .createQueryBuilder('s')
      .leftJoinAndSelect('s.lineItems', 'li')
      .where('s.store_id = :storeId', { storeId })
      .andWhere('s.status = :status', { status: 'completed' })
      .andWhere('s.created_at >= NOW() - INTERVAL :days DAY', { days: daysBack })
      .getMany();

    const totalTickets = sales.length;
    if (totalTickets < MIN_TICKETS_FOR_ASSOCIATION) {
      this.logger.log(`[AI] Only ${totalTickets} tickets (need ${MIN_TICKETS_FOR_ASSOCIATION}) — associations not reliable yet`);
      return [];
    }

    // Build product co-occurrence matrix
    const productTickets = new Map<string, Set<string>>();  // productId → set of saleIds
    const productNames = new Map<string, string>();
    const productPrices = new Map<string, number>();

    for (const sale of sales) {
      for (const item of sale.lineItems) {
        const pid = item.productId;
        if (!pid) continue;
        if (!productTickets.has(pid)) productTickets.set(pid, new Set());
        productTickets.get(pid)!.add(sale.id);
        productNames.set(pid, item.productName || pid);
        productPrices.set(pid, item.unitPriceMinorUnits || 0);
      }
    }

    // Find co-occurrences
    const associations: ProductAssociation[] = [];
    const productIds = Array.from(productTickets.keys());

    for (let i = 0; i < productIds.length; i++) {
      for (let j = i + 1; j < productIds.length; j++) {
        const pidA = productIds[i];
        const pidB = productIds[j];
        const ticketsA = productTickets.get(pidA)!;
        const ticketsB = productTickets.get(pidB)!;

        // Count co-occurrences
        const coOccurrences = [...ticketsA].filter((id) => ticketsB.has(id)).length;

        if (coOccurrences < MIN_COOCCURRENCE) continue;

        const attachmentRateAB = coOccurrences / ticketsA.size;
        const attachmentRateBA = coOccurrences / ticketsB.size;

        // Use the higher attachment rate (A→B or B→A)
        const [mainPid, sugPid, rate, mainTickets] = attachmentRateAB >= attachmentRateBA
          ? [pidA, pidB, attachmentRateAB, ticketsA.size]
          : [pidB, pidA, attachmentRateBA, ticketsB.size];

        if (rate < MIN_ATTACHMENT_RATE) continue;

        // Confidence = f(volume, rate, stability)
        const volumeFactor = Math.min(1, mainTickets / 50); // Caps at 50 tickets
        const rateFactor = Math.min(1, rate / 0.5);          // Caps at 50% rate
        const confidence = (volumeFactor * 0.4 + rateFactor * 0.6);

        associations.push({
          productA: mainPid,
          productAName: productNames.get(mainPid) || mainPid,
          productB: sugPid,
          productBName: productNames.get(sugPid) || sugPid,
          coOccurrences,
          totalTicketsA: mainTickets,
          attachmentRate: rate,
          confidence,
          marginBoost: productPrices.get(sugPid) || 0,
        });
      }
    }

    // Sort by confidence × margin boost
    associations.sort((a, b) => (b.confidence * b.marginBoost) - (a.confidence * a.marginBoost));

    this.logger.log(`[AI] Found ${associations.length} product associations from ${totalTickets} tickets`);
    return associations;
  }

  // ── 2. HOURLY PATTERNS ──
  async computeHourlyPatterns(storeId: string, daysBack = 30): Promise<HourlyPattern[]> {
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
      // Not enough data → strategic silence
      return [{
        type: 'silence',
        message: 'Accumulation de données en cours',
        why: 'Pas assez de ventes pour générer des recommandations fiables',
        confidence: 0,
        impact: 'none',
        scope: storeId,
        actionability: 'info',
        evidence: ['< 20 tickets analysables'],
      }];
    }

    // If cart has items → find upsell opportunities
    if (currentCart.length > 0) {
      const cartProductIds = new Set(currentCart.map((i) => i.productId));

      for (const assoc of associations) {
        // Product A is in cart, suggest B
        if (cartProductIds.has(assoc.productA) && !cartProductIds.has(assoc.productB)) {
          if (assoc.confidence >= MIN_CONFIDENCE) {
            recommendations.push({
              type: 'upsell',
              message: `Proposer ${assoc.productBName}`,
              why: `${Math.round(assoc.attachmentRate * 100)}% des clients qui prennent ${assoc.productAName} prennent aussi ${assoc.productBName}`,
              confidence: assoc.confidence,
              impact: `+${(assoc.marginBoost / 100).toFixed(2)}€ panier moyen`,
              scope: storeId,
              actionability: 'immediate',
              evidence: [
                `${assoc.coOccurrences} co-achats observés`,
                `taux d'association ${Math.round(assoc.attachmentRate * 100)}%`,
                `sur ${assoc.totalTicketsA} tickets`,
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
