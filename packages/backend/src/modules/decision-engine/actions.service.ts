// ── decision-engine/actions.service.ts ──────────────────────────
// Executes actions decided by the rules engine
// create_promo | alert_manager | suggest_price
// ─────────────────────────────────────────────────────────────────

import { Injectable, Logger, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PromoRuleEntity } from '../../database/entities/promo-rule.entity';
import { ProductEntity } from '../../database/entities/product.entity';
import {
  RuleAction,
  ExecutedAction,
  CreatePromoParams,
  AlertManagerParams,
  SuggestPriceParams,
  DecisionContext,
} from './decision-engine.types';
import { GeminiClientService } from '../pos-ai/gemini-client';

/** In-memory alert store for real-time consumption by POS */
export interface ManagerAlert {
  id: string;
  storeId: string;
  severity: 'info' | 'warning' | 'critical';
  title: string;
  message: string;
  suggestedAction?: string;
  ruleId: string;
  /** AI-generated explanation */
  explanation?: string;
  createdAt: string;
  read: boolean;
}

/** Price suggestion for manager review */
export interface PriceSuggestion {
  id: string;
  storeId: string;
  productId: string;
  productName: string;
  currentPriceMinorUnits: number;
  suggestedPriceMinorUnits: number;
  adjustmentPercent: number;
  reason: string;
  ruleId: string;
  createdAt: string;
  status: 'pending' | 'accepted' | 'rejected';
}

@Injectable()
export class ActionsService {
  private readonly logger = new Logger('DecisionEngine:Actions');

  /** In-memory alert store (per store) */
  private readonly alerts = new Map<string, ManagerAlert[]>();

  /** In-memory price suggestions (per store) */
  private readonly priceSuggestions = new Map<string, PriceSuggestion[]>();

  constructor(
    @InjectRepository(PromoRuleEntity)
    private readonly promoRepo: Repository<PromoRuleEntity>,
    @InjectRepository(ProductEntity)
    private readonly productRepo: Repository<ProductEntity>,
    @Optional() private readonly gemini?: GeminiClientService,
  ) {}

  /**
   * Execute a single action and return the result.
   */
  async executeAction(
    action: RuleAction,
    storeId: string,
    ruleId: string,
    context: DecisionContext,
  ): Promise<ExecutedAction> {
    try {
      switch (action.type) {
        case 'create_promo':
          return await this.executeCreatePromo(
            action.params as CreatePromoParams,
            storeId,
            ruleId,
          );

        case 'alert_manager':
          return await this.executeAlertManager(
            action.params as AlertManagerParams,
            storeId,
            ruleId,
            context,
          );

        case 'suggest_price':
          return await this.executeSuggestPrice(
            action.params as SuggestPriceParams,
            storeId,
            ruleId,
            context,
          );

        default:
          return {
            type: action.type,
            params: action.params,
            success: false,
            error: `Unknown action type: ${action.type}`,
          };
      }
    } catch (err: any) {
      this.logger.error(
        `Action ${action.type} failed for store ${storeId}: ${err.message}`,
      );
      return {
        type: action.type,
        params: action.params,
        success: false,
        error: err.message,
      };
    }
  }

  // ═══════════════════════════════════════════════════════════════
  //  ACTION: CREATE PROMO
  // ═══════════════════════════════════════════════════════════════

  private async executeCreatePromo(
    params: CreatePromoParams,
    storeId: string,
    ruleId: string,
  ): Promise<ExecutedAction> {
    const now = new Date();
    const endDate = new Date(
      now.getTime() + params.durationHours * 60 * 60 * 1000,
    );

    // Check if a similar auto-promo already exists and is active
    const existing = await this.promoRepo.findOne({
      where: {
        storeId,
        name: params.name,
        isActive: true,
      },
    });

    if (existing) {
      this.logger.debug(
        `Promo "${params.name}" already active for store ${storeId}, skipping`,
      );
      return {
        type: 'create_promo',
        params,
        success: true,
        result: {
          promoId: existing.id,
          message: 'Promo déjà active, réutilisation',
          alreadyExisted: true,
        },
      };
    }

    const promoData: Partial<PromoRuleEntity> = {
      name: `[AUTO] ${params.name}`,
      type: params.type,
      storeId,
      applicableCategoryIds: params.targetCategoryIds || [],
      applicableProductIds: params.targetProductIds || [],
      startDate: now,
      endDate,
      isActive: true,
    };
    if (params.discountPercent != null) {
      promoData.discountPercent = params.discountPercent;
    }
    if (params.discountFixedMinorUnits != null) {
      promoData.discountFixedMinorUnits = params.discountFixedMinorUnits;
    }

    const saved = await this.promoRepo.save(promoData);

    this.logger.log(
      `[${ruleId}] Created promo "${saved.name}" (${saved.id}) for store ${storeId}, expires ${endDate.toISOString()}`,
    );

    return {
      type: 'create_promo',
      params,
      success: true,
      result: {
        promoId: saved.id,
        promoName: saved.name,
        expiresAt: endDate.toISOString(),
      },
    };
  }

  // ═══════════════════════════════════════════════════════════════
  //  ACTION: ALERT MANAGER
  // ═══════════════════════════════════════════════════════════════

  private async executeAlertManager(
    params: AlertManagerParams,
    storeId: string,
    ruleId: string,
    context: DecisionContext,
  ): Promise<ExecutedAction> {
    // Generate AI explanation if Gemini available
    let explanation: string | undefined;
    if (this.gemini?.isAvailable()) {
      try {
        explanation = await this.generateExplanation(params, context);
      } catch {
        // Non-blocking: explanation is optional
      }
    }

    const alert: ManagerAlert = {
      id: `alert-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`,
      storeId,
      severity: params.severity,
      title: params.title,
      message: params.message,
      suggestedAction: params.suggestedAction,
      ruleId,
      explanation,
      createdAt: new Date().toISOString(),
      read: false,
    };

    // Store in memory (keep last 50 alerts per store)
    if (!this.alerts.has(storeId)) {
      this.alerts.set(storeId, []);
    }
    const storeAlerts = this.alerts.get(storeId)!;
    storeAlerts.unshift(alert);
    if (storeAlerts.length > 50) {
      storeAlerts.splice(50);
    }

    this.logger.log(
      `[${ruleId}] Alert [${params.severity}] for store ${storeId}: ${params.title}`,
    );

    return {
      type: 'alert_manager',
      params,
      success: true,
      result: { alertId: alert.id, explanation },
    };
  }

  // ═══════════════════════════════════════════════════════════════
  //  ACTION: SUGGEST PRICE
  // ═══════════════════════════════════════════════════════════════

  private async executeSuggestPrice(
    params: SuggestPriceParams,
    storeId: string,
    ruleId: string,
    context: DecisionContext,
  ): Promise<ExecutedAction> {
    let productIds: string[] = [];

    // Determine which products to target
    switch (params.strategy) {
      case 'slow_moving':
        productIds = context.sales.slowMovingProductIds?.slice(0, 10) || [];
        break;
      case 'high_demand':
        productIds = context.sales.topSellingProductIds?.slice(0, 5) || [];
        break;
      case 'category':
        if (params.targetCategoryIds?.length) {
          const products = await this.productRepo.find({
            where: { storeId, isActive: true },
            select: ['id', 'categoryId', 'name', 'priceMinorUnits'],
          });
          productIds = products
            .filter((p) => params.targetCategoryIds!.includes(p.categoryId || ''))
            .slice(0, 10)
            .map((p) => p.id);
        }
        break;
    }

    if (params.targetProductIds?.length) {
      productIds = params.targetProductIds;
    }

    if (productIds.length === 0) {
      return {
        type: 'suggest_price',
        params,
        success: true,
        result: { suggestions: 0, message: 'Aucun produit éligible' },
      };
    }

    // Load product details
    const products = await this.productRepo.find({
      where: { storeId, isActive: true },
      select: ['id', 'name', 'priceMinorUnits'],
    });

    const productMap = new Map(products.map((p) => [p.id, p]));
    const suggestions: PriceSuggestion[] = [];

    for (const productId of productIds) {
      const product = productMap.get(productId);
      if (!product) continue;

      const adjustedPrice = Math.round(
        product.priceMinorUnits * (1 + params.adjustmentPercent / 100),
      );

      // Don't suggest if price would go below cost (safety)
      if (adjustedPrice <= 0) continue;

      const suggestion: PriceSuggestion = {
        id: `suggestion-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`,
        storeId,
        productId,
        productName: product.name,
        currentPriceMinorUnits: product.priceMinorUnits,
        suggestedPriceMinorUnits: adjustedPrice,
        adjustmentPercent: params.adjustmentPercent,
        reason: params.reason,
        ruleId,
        createdAt: new Date().toISOString(),
        status: 'pending',
      };

      suggestions.push(suggestion);
    }

    // Store suggestions (keep last 30 per store)
    if (!this.priceSuggestions.has(storeId)) {
      this.priceSuggestions.set(storeId, []);
    }
    const storeSuggestions = this.priceSuggestions.get(storeId)!;
    storeSuggestions.unshift(...suggestions);
    if (storeSuggestions.length > 30) {
      storeSuggestions.splice(30);
    }

    this.logger.log(
      `[${ruleId}] Created ${suggestions.length} price suggestion(s) for store ${storeId}`,
    );

    return {
      type: 'suggest_price',
      params,
      success: true,
      result: {
        suggestions: suggestions.length,
        products: suggestions.map((s) => ({
          name: s.productName,
          current: s.currentPriceMinorUnits,
          suggested: s.suggestedPriceMinorUnits,
        })),
      },
    };
  }

  // ═══════════════════════════════════════════════════════════════
  //  AI EXPLANATION (Gemini generates, never decides)
  // ═══════════════════════════════════════════════════════════════

  private async generateExplanation(
    params: AlertManagerParams,
    context: DecisionContext,
  ): Promise<string> {
    const contextSummary = this.contextToSummary(context);

    const prompt = `En une phrase concise en français, explique pourquoi cette alerte a été déclenchée pour un manager de magasin.

Alerte: ${params.title}
Message: ${params.message}

Contexte actuel:
${contextSummary}

Réponds en une seule phrase explicative, sans répéter le titre.`;

    const systemPrompt =
      'Tu es un assistant POS. Tu expliques des décisions automatiques à un manager. Sois concis et actionnable.';

    const result = await this.gemini!.generate(prompt, systemPrompt);
    return result || '';
  }

  private contextToSummary(ctx: DecisionContext): string {
    const parts: string[] = [];

    if (ctx.weather.available) {
      parts.push(
        `Météo: ${ctx.weather.temp}°C, ${ctx.weather.condition}${ctx.weather.isRaining ? ', pluie' : ''}`,
      );
    }
    if (ctx.transport.available) {
      parts.push(
        `Transport: ${ctx.transport.status}, ${ctx.transport.activeDisruptions} perturbation(s)`,
      );
    }
    if (ctx.footfall.available) {
      parts.push(
        `Affluence: score ${ctx.footfall.score}/100 (${ctx.footfall.level})`,
      );
    }
    if (ctx.sales.available) {
      parts.push(
        `Ventes dernière heure: ${ctx.sales.lastHourCount}, CA: ${((ctx.sales.lastHourRevenue || 0) / 100).toFixed(2)} EUR`,
      );
    }
    if (ctx.stock.available) {
      parts.push(
        `Stock: ${ctx.stock.criticalCount} critique(s), ${ctx.stock.outOfStockCount} rupture(s)`,
      );
    }

    parts.push(`Heure: ${ctx.time.hour}h, ${ctx.time.isWeekend ? 'weekend' : 'semaine'}`);

    return parts.join('\n');
  }

  // ═══════════════════════════════════════════════════════════════
  //  PUBLIC — Read alerts & suggestions (for controller/POS)
  // ═══════════════════════════════════════════════════════════════

  getAlerts(storeId: string, unreadOnly = false): ManagerAlert[] {
    const alerts = this.alerts.get(storeId) || [];
    return unreadOnly ? alerts.filter((a) => !a.read) : alerts;
  }

  markAlertRead(storeId: string, alertId: string): boolean {
    const alerts = this.alerts.get(storeId) || [];
    const alert = alerts.find((a) => a.id === alertId);
    if (alert) {
      alert.read = true;
      return true;
    }
    return false;
  }

  getPriceSuggestions(storeId: string): PriceSuggestion[] {
    return this.priceSuggestions.get(storeId) || [];
  }

  updateSuggestionStatus(
    storeId: string,
    suggestionId: string,
    status: 'accepted' | 'rejected',
  ): boolean {
    const suggestions = this.priceSuggestions.get(storeId) || [];
    const suggestion = suggestions.find((s) => s.id === suggestionId);
    if (suggestion) {
      suggestion.status = status;
      return true;
    }
    return false;
  }
}
