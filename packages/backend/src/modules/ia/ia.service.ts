import { Injectable, ForbiddenException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ProductEntity } from '../../database/entities/product.entity';
import { SaleEntity } from '../../database/entities/sale.entity';
import { SaleLineItemEntity } from '../../database/entities/sale-line-item.entity';
import { ClaudeService } from './claude.service';
import { IaDataService, StoreDataContext } from './ia-data.service';

/**
 * IA Pricing, Forecasting & Generative AI Service
 *
 * MVP: Rule-based engine for pricing/forecasting.
 * V2: Claude AI integration for conversational reports.
 *
 * Interface contract:
 * - suggestPrice(productId): PricingSuggestion
 * - forecastRevenue(storeId, date): RevenueForecast
 * - chatWithClaude(storeId, message): { response }
 * - generateAiReport(storeId, reportType): { report }
 */

export interface PricingSuggestion {
  productId: string;
  currentPriceMinorUnits: number;
  suggestedPriceMinorUnits: number;
  minPriceMinorUnits: number;
  maxPriceMinorUnits: number;
  confidence: number;
  reasoning: string;
  factors: {
    rotationSpeed: number;
    currentStock: number;
    marginPercent: number;
    elasticity: number;
  };
}

export interface RevenueForecast {
  storeId: string;
  date: string;
  estimatedRevenueMinorUnits: number;
  confidenceIntervalLow: number;
  confidenceIntervalHigh: number;
  factors: {
    dayOfWeek: string;
    isHoliday: boolean;
    holidayName?: string;
    historicalAverage: number;
    trend: number;
  };
}

// Day-of-week multipliers (empirical retail patterns)
const DAY_MULTIPLIERS: Record<string, number> = {
  Monday: 0.85,
  Tuesday: 0.9,
  Wednesday: 0.95,
  Thursday: 1.0,
  Friday: 1.15,
  Saturday: 1.3,
  Sunday: 0.7,
};

@Injectable()
export class IaService {
  private readonly logger = new Logger(IaService.name);

  constructor(
    @InjectRepository(ProductEntity)
    private productRepo: Repository<ProductEntity>,
    @InjectRepository(SaleEntity)
    private saleRepo: Repository<SaleEntity>,
    @InjectRepository(SaleLineItemEntity)
    private lineItemRepo: Repository<SaleLineItemEntity>,
    private claudeService: ClaudeService,
    private dataService: IaDataService,
  ) {}

  /**
   * Suggest a price for a product based on rule-based analysis.
   *
   * Rules:
   * 1. High stock + low rotation -> suggest lower price (up to -20%)
   * 2. Low stock + high rotation -> suggest higher price (up to +20%)
   * 3. Factor in cost price for minimum margin of 15%
   * 4. Elasticity estimate based on discount response history
   */
  async suggestPrice(
    productId: string,
    storeId: string,
  ): Promise<PricingSuggestion> {
    const product = await this.productRepo.findOne({
      where: { id: productId, storeId },
    });
    if (!product) {
      throw new ForbiddenException(
        'Product not found or belongs to another store.',
      );
    }

    // Calculate rotation speed (avg sales per day over last 30 days)
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const salesData = await this.lineItemRepo
      .createQueryBuilder('li')
      .select('SUM(li.quantity)', 'totalQty')
      .where('li.product_id = :productId', { productId })
      .andWhere('li.sale_id IN (SELECT id FROM sales WHERE created_at >= :since)', {
        since: thirtyDaysAgo,
      })
      .getRawOne();

    const totalQty = parseInt(salesData?.totalQty || '0');
    const rotationSpeed = totalQty / 30;

    // Calculate margin
    const costPrice = product.costMinorUnits || Math.round(product.priceMinorUnits * 0.5);
    const currentMargin =
      ((product.priceMinorUnits - costPrice) / product.priceMinorUnits) * 100;

    // Determine adjustment
    let priceAdjustment = 0;
    let reasoning = '';

    // High stock + low rotation -> lower price
    if (product.stockQuantity > product.stockAlertThreshold * 3 && rotationSpeed < 1) {
      priceAdjustment = -0.1; // -10%
      reasoning = 'Stock eleve et rotation lente: reduction recommandee pour accelerer les ventes';
    }
    // Very high stock -> more aggressive
    else if (product.stockQuantity > product.stockAlertThreshold * 5 && rotationSpeed < 0.5) {
      priceAdjustment = -0.15;
      reasoning = 'Surstock important: reduction significative recommandee';
    }
    // Low stock + high rotation -> higher price
    else if (product.stockQuantity <= product.stockAlertThreshold && rotationSpeed > 3) {
      priceAdjustment = 0.1; // +10%
      reasoning = 'Stock bas et forte demande: augmentation recommandee';
    }
    // Very low stock + very high rotation
    else if (product.stockQuantity <= product.stockCriticalThreshold && rotationSpeed > 5) {
      priceAdjustment = 0.15;
      reasoning = 'Stock critique et demande tres forte: augmentation significative recommandee';
    }
    // Normal
    else {
      reasoning = 'Stock et rotation equilibres: prix actuel correct';
    }

    // Ensure minimum margin of 15%
    const minMarginPrice = Math.round(costPrice / (1 - 0.15));
    const suggestedRaw = Math.round(product.priceMinorUnits * (1 + priceAdjustment));
    const suggestedPrice = Math.max(suggestedRaw, minMarginPrice);

    // Bounds: -20% to +20% of current price
    const minPrice = Math.max(
      Math.round(product.priceMinorUnits * 0.8),
      minMarginPrice,
    );
    const maxPrice = Math.round(product.priceMinorUnits * 1.2);

    // Simple elasticity estimate
    const elasticity = rotationSpeed > 0 ? Math.min(2.0, 1 / rotationSpeed) : 1.0;

    return {
      productId,
      currentPriceMinorUnits: product.priceMinorUnits,
      suggestedPriceMinorUnits: suggestedPrice,
      minPriceMinorUnits: minPrice,
      maxPriceMinorUnits: maxPrice,
      confidence: rotationSpeed > 0 ? Math.min(0.8, rotationSpeed / 5) : 0.2,
      reasoning,
      factors: {
        rotationSpeed: Math.round(rotationSpeed * 100) / 100,
        currentStock: product.stockQuantity,
        marginPercent: Math.round(currentMargin * 100) / 100,
        elasticity: Math.round(elasticity * 100) / 100,
      },
    };
  }

  /**
   * Forecast revenue for a store on a given date.
   *
   * MVP Rules:
   * 1. Historical average daily revenue (last 30 days)
   * 2. Day-of-week multiplier (Sat=1.3, Mon=0.85, etc.)
   * 3. Holiday flag (manual input for now)
   * 4. Trend: compare last 7 days to previous 7 days
   */
  async forecastRevenue(
    storeId: string,
    date: string,
    isHoliday = false,
    holidayName?: string,
  ): Promise<RevenueForecast> {
    const targetDate = new Date(date);
    const dayOfWeek = targetDate.toLocaleDateString('en-US', {
      weekday: 'long',
    });

    // Historical average (last 30 days)
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const revenueData = await this.saleRepo
      .createQueryBuilder('s')
      .select('SUM(s.total_minor_units)', 'totalRevenue')
      .addSelect('COUNT(DISTINCT DATE(s.created_at))', 'dayCount')
      .where('s.store_id = :storeId', { storeId })
      .andWhere('s.status = :status', { status: 'completed' })
      .andWhere('s.created_at >= :since', { since: thirtyDaysAgo })
      .getRawOne();

    const totalRevenue = parseInt(revenueData?.totalRevenue || '0');
    const dayCount = parseInt(revenueData?.dayCount || '1');
    const historicalAvg = Math.round(totalRevenue / Math.max(dayCount, 1));

    // Recent trend: last 7 days vs previous 7 days
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const fourteenDaysAgo = new Date();
    fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14);

    const recentData = await this.saleRepo
      .createQueryBuilder('s')
      .select('SUM(s.total_minor_units)', 'revenue')
      .where('s.store_id = :storeId', { storeId })
      .andWhere('s.status = :status', { status: 'completed' })
      .andWhere('s.created_at >= :since', { since: sevenDaysAgo })
      .getRawOne();

    const previousData = await this.saleRepo
      .createQueryBuilder('s')
      .select('SUM(s.total_minor_units)', 'revenue')
      .where('s.store_id = :storeId', { storeId })
      .andWhere('s.status = :status', { status: 'completed' })
      .andWhere('s.created_at >= :from', { from: fourteenDaysAgo })
      .andWhere('s.created_at < :to', { to: sevenDaysAgo })
      .getRawOne();

    const recentRevenue = parseInt(recentData?.revenue || '0');
    const previousRevenue = parseInt(previousData?.revenue || '1');
    const trend =
      previousRevenue > 0
        ? ((recentRevenue - previousRevenue) / previousRevenue) * 100
        : 0;

    // Apply multipliers
    const dayMultiplier = DAY_MULTIPLIERS[dayOfWeek] || 1.0;
    const holidayMultiplier = isHoliday ? 0.4 : 1.0; // holidays = less traffic
    const trendMultiplier = 1 + trend / 100;

    const estimated = Math.round(
      historicalAvg * dayMultiplier * holidayMultiplier * trendMultiplier,
    );

    // Confidence interval: +/- 25%
    const confidenceLow = Math.round(estimated * 0.75);
    const confidenceHigh = Math.round(estimated * 1.25);

    return {
      storeId,
      date,
      estimatedRevenueMinorUnits: estimated,
      confidenceIntervalLow: confidenceLow,
      confidenceIntervalHigh: confidenceHigh,
      factors: {
        dayOfWeek,
        isHoliday,
        holidayName,
        historicalAverage: historicalAvg,
        trend: Math.round(trend * 100) / 100,
      },
    };
  }

  // ── Claude AI Methods ───────────────────────────────────────────────────

  /**
   * Chat conversationnel avec Claude – envoie le contexte magasin
   * et l'historique de conversation pour obtenir une réponse contextuelle.
   */
  async chatWithClaude(
    storeId: string,
    message: string,
    history?: { role: string; content: string }[],
  ): Promise<{ response: string }> {
    this.logger.log(`chatWithClaude called for store ${storeId}`);

    let context: StoreDataContext;
    try {
      context = await this.dataService.buildStoreContext(storeId);
      this.logger.log(`Store context built: ${context.storeName}, ${context.transactionCount} tx`);
    } catch (err: any) {
      this.logger.error(`Failed to build store context: ${err?.message}`, err?.stack);
      throw err;
    }

    const systemPrompt = this.buildSystemPrompt(context);

    // Construire les messages : historique + nouveau message
    const messages = [
      ...(history || []).map((h) => ({
        role: h.role as 'user' | 'assistant',
        content: h.content,
      })),
      { role: 'user' as const, content: message },
    ];

    const result = await this.claudeService.chat(systemPrompt, messages);

    this.logger.log(
      `Claude chat for store ${storeId}: ${result.usage.inputTokens}+${result.usage.outputTokens} tokens`,
    );

    return { response: result.text };
  }

  /**
   * Génère un rapport IA structuré selon le type demandé.
   */
  async generateAiReport(
    storeId: string,
    reportType: string,
    date?: string,
  ): Promise<{ report: string }> {
    // Récupérer les données spécifiques au type de rapport
    let data: any;
    switch (reportType) {
      case 'daily_summary':
        data = await this.dataService.getDailySummaryData(
          storeId,
          date || new Date().toISOString().slice(0, 10),
        );
        break;
      case 'weekly_analysis':
        data = await this.dataService.getWeeklyData(storeId);
        break;
      case 'product_performance':
        data = await this.dataService.getProductData(storeId);
        break;
      case 'cashier_analysis':
        data = await this.dataService.getCashierData(storeId);
        break;
      default:
        data = await this.dataService.buildStoreContext(storeId);
    }

    const context = await this.dataService.buildStoreContext(storeId);
    const systemPrompt = this.buildSystemPrompt(context);
    const userPrompt = this.buildReportPrompt(reportType, data);

    const result = await this.claudeService.chat(systemPrompt, [
      { role: 'user', content: userPrompt },
    ]);

    this.logger.log(
      `Claude report "${reportType}" for store ${storeId}: ${result.usage.inputTokens}+${result.usage.outputTokens} tokens`,
    );

    return { report: result.text };
  }

  // ── Prompt builders ─────────────────────────────────────────────────────

  private buildSystemPrompt(context: StoreDataContext): string {
    const fmt = (minorUnits: number) => (minorUnits / 100).toFixed(2);

    return `Tu es un assistant IA expert en analyse commerciale pour CAISSE, un systeme de point de vente.

CONTEXTE MAGASIN:
- Nom: ${context.storeName}
- Periode analysee: 7 derniers jours
- CA total: ${fmt(context.totalRevenueMinorUnits)} EUR
- Nombre de transactions: ${context.transactionCount}
- Panier moyen: ${fmt(context.averageBasketMinorUnits)} EUR
- Equipe: ${context.employeeCount} employes (${Object.entries(context.employeesByRole).map(([r, c]) => `${c} ${r}`).join(', ')})

TOP PRODUITS (7 derniers jours):
${context.topProducts.map((p, i) => `${i + 1}. ${p.name}: ${p.quantity} vendus, ${fmt(p.revenueMinorUnits)} EUR`).join('\n')}

ALERTES STOCK:
${context.stockAlerts.length > 0 ? context.stockAlerts.map((a) => `- ${a.name}: ${a.stock} unites (seuil: ${a.threshold})`).join('\n') : '- Aucune alerte stock'}

Z-REPORTS RECENTS:
${context.zReports.map((z) => `- ${z.date}: CA ${fmt(z.revenueMinorUnits)} EUR, ${z.transactions} tx, especes ${fmt(z.cashMinorUnits)} EUR, CB ${fmt(z.cardMinorUnits)} EUR`).join('\n') || '- Aucun Z-report disponible'}

REGLES:
1. Reponds TOUJOURS en francais
2. Ton professionnel mais accessible
3. Recommandations ACTIONNABLES avec donnees precises (montants, pourcentages)
4. Structure tes reponses en Markdown: ## titres, **gras** pour les chiffres cles, - listes a puces
5. Montants toujours en euros
6. Si les donnees sont insuffisantes pour une analyse, dis-le clairement
7. Sois concis: maximum 500 mots par reponse`;
  }

  private buildReportPrompt(reportType: string, data: any): string {
    const json = JSON.stringify(data, null, 2);

    const prompts: Record<string, string> = {
      daily_summary: `Genere une synthese complete de la journee basee sur ces donnees:
${json}

Structure ta reponse:
## Resume de la journee
## Top produits
## Repartition des paiements
## Alertes et actions a prendre
## Recommandations`,

      weekly_analysis: `Analyse la semaine ecoulee et fournis des insights strategiques:
${json}

Structure ta reponse:
## Tendances hebdomadaires
## Evolution du CA jour par jour
## Points forts et points faibles
## Plan d'action pour la semaine prochaine`,

      product_performance: `Analyse la performance des produits:
${json}

Structure ta reponse:
## Produits stars (meilleurs CA)
## Produits en difficulte (dormants, faible rotation)
## Opportunites de marge
## Recommandations stock et pricing`,

      cashier_analysis: `Evalue la performance de l'equipe de caissiers:
${json}

Structure ta reponse:
## Classement de l'equipe
## Indicateurs cles (CA, vitesse, panier moyen)
## Taux d'annulation et alertes
## Recommandations formation et organisation`,
    };

    return prompts[reportType] || `Analyse ces donnees et fournis un rapport:\n${json}`;
  }
}
