// ── pos-ai/assistant.ts ─────────────────────────────────────────
// POS Manager AI Assistant — answers questions about the catalog
// Uses embeddings + vector search + Gemini for complex queries
// ─────────────────────────────────────────────────────────────────

import { Injectable, Logger, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ProductEntity } from '../../database/entities/product.entity';
import { GeminiClientService } from './gemini-client';
import { ProductSearchService } from './product-search';
import { AnomalyInsightsService } from './anomaly-insights';
import { AssistantResponse } from './types';
import { WeatherService } from '../weather/weather.service';
import { StoreContextService } from './store-context.service';
import { TransportService } from '../transport/transport.service';
import { FootfallService } from '../footfall/footfall.service';

@Injectable()
export class AssistantService {
  private readonly logger = new Logger('POS-AI:Assistant');

  constructor(
    @InjectRepository(ProductEntity)
    private readonly productRepo: Repository<ProductEntity>,
    private readonly gemini: GeminiClientService,
    private readonly productSearch: ProductSearchService,
    private readonly anomalies: AnomalyInsightsService,
    @Optional() private readonly weatherService?: WeatherService,
    @Optional() private readonly storeContext?: StoreContextService,
    @Optional() private readonly transportService?: TransportService,
    @Optional() private readonly footfallService?: FootfallService,
  ) {}

  /**
   * Answer a manager's question about the catalog/products
   */
  async ask(storeId: string, question: string): Promise<AssistantResponse> {
    const q = question.toLowerCase();

    // ── Route 1: "products like X" → vector similarity ──
    if (/ressemble|similaire|comme|pareil|alternative|equivalent|similar/i.test(q)) {
      return this.handleSimilarityQuery(storeId, question);
    }

    // ── Route 2: "duplicates/confusion" → anomaly detection ──
    if (/doublon|dupli|confondu|confusion|incoh|erreur/i.test(q)) {
      return this.handleAnomalyQuery(storeId, question);
    }

    // ── Route 3: "family/category" → category analysis ──
    if (/famille|categorie|rayon|meme type|meme genre/i.test(q)) {
      return this.handleCategoryQuery(storeId, question);
    }

    // ── Route 4: Complex question → Gemini with context ──
    return this.handleGeminiQuery(storeId, question);
  }

  private async handleSimilarityQuery(storeId: string, question: string): Promise<AssistantResponse> {
    // Extract product name from the question
    const searchTerms = question
      .replace(/(?:quels?|produits?|articles?|ressemblent?|similaires?|comme|pareil)/gi, '')
      .trim();

    const { results } = await this.productSearch.semanticSearch(storeId, searchTerms, 5);

    if (results.length === 0) {
      return {
        answer: `Aucun produit similaire trouve pour "${searchTerms}". Verifiez que le catalogue est synchronise (POST /api/pos-ai/sync-products).`,
        relatedProducts: [],
        confidence: 0.3,
        source: 'embeddings',
      };
    }

    const productList = results
      .map((r, i) => `${i + 1}. ${r.name} (${(r.priceMinorUnits / 100).toFixed(2)} EUR, similarite: ${Math.round(r.score * 100)}%)`)
      .join('\n');

    return {
      answer: `Produits similaires a "${searchTerms}" :\n${productList}`,
      relatedProducts: results,
      confidence: results[0]?.score || 0.5,
      source: 'embeddings',
    };
  }

  private async handleAnomalyQuery(storeId: string, _question: string): Promise<AssistantResponse> {
    const alerts = await this.anomalies.scanAnomalies(storeId);

    if (alerts.length === 0) {
      return {
        answer: 'Aucune anomalie detectee dans le catalogue. Tous les produits semblent bien nommes et classes.',
        relatedProducts: [],
        confidence: 0.8,
        source: 'embeddings',
      };
    }

    const summary = alerts
      .slice(0, 10)
      .map((a) => `- [${a.severity.toUpperCase()}] ${a.message}\n  Suggestion: ${a.suggestion}`)
      .join('\n');

    return {
      answer: `${alerts.length} anomalie(s) detectee(s) :\n\n${summary}`,
      relatedProducts: [],
      confidence: 0.7,
      source: 'embeddings',
    };
  }

  private async handleCategoryQuery(storeId: string, question: string): Promise<AssistantResponse> {
    // Extract category name from question
    const searchTerms = question
      .replace(/(?:quels?|articles?|produits?|famille|categorie|rayon|vendons|avons|meme|type|genre)/gi, '')
      .trim();

    const { results } = await this.productSearch.semanticSearch(storeId, searchTerms, 10);

    if (results.length === 0) {
      return {
        answer: `Aucun produit trouve dans la famille "${searchTerms}".`,
        relatedProducts: [],
        confidence: 0.3,
        source: 'embeddings',
      };
    }

    // Group by category
    const byCategory = new Map<string, typeof results>();
    for (const r of results) {
      const cat = r.categoryId || 'Sans categorie';
      if (!byCategory.has(cat)) byCategory.set(cat, []);
      byCategory.get(cat)!.push(r);
    }

    let answer = `Produits lies a "${searchTerms}" :\n`;
    for (const [cat, prods] of byCategory) {
      answer += `\n📁 ${cat} (${prods.length} produit(s)):\n`;
      answer += prods.map((p) => `  - ${p.name} (${(p.priceMinorUnits / 100).toFixed(2)} EUR)`).join('\n');
    }

    return {
      answer,
      relatedProducts: results,
      confidence: 0.6,
      source: 'embeddings',
    };
  }

  private async handleGeminiQuery(storeId: string, question: string): Promise<AssistantResponse> {
    if (!this.gemini.isAvailable()) {
      // Fallback: try semantic search with the raw question
      const { results } = await this.productSearch.semanticSearch(storeId, question, 5);
      return {
        answer: results.length > 0
          ? `Gemini indisponible. Voici les produits les plus pertinents pour votre question :\n` +
            results.map((r, i) => `${i + 1}. ${r.name}`).join('\n')
          : 'Gemini indisponible et aucun produit pertinent trouve.',
        relatedProducts: results,
        confidence: 0.3,
        source: 'rules',
      };
    }

    // Get some products for context
    const products = await this.productRepo.find({
      where: { storeId, isActive: true },
      select: ['id', 'name', 'categoryId', 'priceMinorUnits', 'stockQuantity'],
      take: 100,
    });

    const productContext = products
      .map((p) => `- ${p.name} (cat: ${p.categoryId || 'N/A'}, ${(p.priceMinorUnits / 100).toFixed(2)} EUR, stock: ${p.stockQuantity})`)
      .join('\n');

    // ── Weather context (if available) ──
    let weatherContext = '';
    if (this.weatherService) {
      try {
        const weather = await this.weatherService.getWeather(storeId);
        if (weather) {
          weatherContext = `\nMeteo actuelle : ${weather.current.temp}°C (ressenti ${weather.current.feelsLike}°C), ${weather.current.condition}.
Categorie meteo : ${weather.current.businessCategory}.
Impact trafic : ${weather.trafficImpact.message} (${weather.trafficImpact.estimatedImpactPercent > 0 ? '+' : ''}${weather.trafficImpact.estimatedImpactPercent}%).
${weather.recommendations.map((r) => `Recommandation meteo : ${r.message}`).join('\n')}`;
        }
      } catch (err: any) {
        this.logger.debug(`Weather context unavailable: ${err.message}`);
      }
    }

    // ── Store context (if available) ──
    let storeContextText = '';
    if (this.storeContext) {
      try {
        storeContextText = await this.storeContext.getContextForPrompt(storeId);
      } catch (err: any) {
        this.logger.debug(`Store context unavailable: ${err.message}`);
      }
    }

    // ── Transport context (if available) ──
    let transportContext = '';
    if (this.transportService) {
      try {
        transportContext = await this.transportService.getContextForPrompt(storeId);
      } catch (err: any) {
        this.logger.debug(`Transport context unavailable: ${err.message}`);
      }
    }

    // ── Footfall context (if available) ──
    let footfallContext = '';
    if (this.footfallService) {
      try {
        footfallContext = await this.footfallService.getContextForPrompt(storeId);
      } catch (err: any) {
        this.logger.debug(`Footfall context unavailable: ${err.message}`);
      }
    }

    const systemPrompt = `Tu es un assistant manager pour un point de vente (POS).
Tu reponds en francais, de maniere concise et actionnable.
Voici le catalogue actuel du magasin :
${productContext}
${weatherContext}
${storeContextText}
${transportContext}
${footfallContext}
Reponds a la question du manager en te basant sur ces donnees.`;

    const answer = await this.gemini.generate(question, systemPrompt);

    // Also do a semantic search to attach related products
    const { results } = await this.productSearch.semanticSearch(storeId, question, 5);

    return {
      answer: answer || 'Impossible de generer une reponse. Verifiez la connexion Gemini.',
      relatedProducts: results,
      confidence: answer ? 0.7 : 0.1,
      source: 'gemini',
    };
  }
}
