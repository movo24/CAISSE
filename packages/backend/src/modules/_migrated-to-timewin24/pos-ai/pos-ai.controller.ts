// ── pos-ai/pos-ai.controller.ts ─────────────────────────────────
// REST endpoints for POS AI module
// All routes under /api/pos-ai/*
// ─────────────────────────────────────────────────────────────────

import { Controller, Get, Post, Body, Query, Request, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard, Roles } from '../../common/guards/roles.guard';
import { Throttle } from '@nestjs/throttler';
import { GeminiClientService } from './gemini-client';
import { EmbeddingService } from './embeddings';
import { VectorStoreService } from './vector-store';
import { ProductSearchService } from './product-search';
import { NaturalQueryService } from './natural-query';
import { AssistantService } from './assistant';
import { AnomalyInsightsService } from './anomaly-insights';
import { StoreContextService } from './store-context.service';
import { POS_AI_CONFIG } from './config';

@Controller('pos-ai')
export class PosAiController {
  constructor(
    private readonly geminiClient: GeminiClientService,
    private readonly embeddings: EmbeddingService,
    private readonly vectorStore: VectorStoreService,
    private readonly productSearch: ProductSearchService,
    private readonly naturalQuery: NaturalQueryService,
    private readonly assistant: AssistantService,
    private readonly anomalyInsights: AnomalyInsightsService,
    private readonly storeContext: StoreContextService,
  ) {}

  // ═══════════════════════════════════════════════════════
  //  HEALTH & DIAGNOSTICS (public, no auth needed)
  // ═══════════════════════════════════════════════════════

  /** Health check — is the AI module operational? */
  @Get('health')
  async health() {
    const geminiTest = await this.geminiClient.testConnection();
    const embeddingsCount = await this.vectorStore.countEmbeddings();

    return {
      enabled: POS_AI_CONFIG.enabled,
      gemini: {
        connected: geminiTest.connected,
        model: geminiTest.model,
        error: geminiTest.error,
      },
      vectorStore: {
        available: this.vectorStore.isAvailable(),
        totalEmbeddings: embeddingsCount,
      },
      config: {
        embeddingModel: POS_AI_CONFIG.geminiEmbeddingModel,
        embeddingDimensions: POS_AI_CONFIG.embeddingDimensions,
        similarityThreshold: POS_AI_CONFIG.similarityThreshold,
      },
    };
  }

  // ═══════════════════════════════════════════════════════
  //  TEST ENDPOINTS (auth required, admin/manager only)
  // ═══════════════════════════════════════════════════════

  /** Test Gemini connection with a simple prompt */
  @Get('test-gemini')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin', 'manager')
  async testGemini() {
    return this.geminiClient.testConnection();
  }

  /** Test embedding generation */
  @Post('test-embedding')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin', 'manager')
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  async testEmbedding(@Body() body: { text: string }) {
    const startTime = Date.now();
    const result = await this.embeddings.generateEmbedding(body.text);

    if (!result) {
      return {
        success: false,
        error: 'Embedding generation failed — check GEMINI_API_KEY',
        durationMs: Date.now() - startTime,
      };
    }

    return {
      success: true,
      text: result.text,
      dimensions: result.dimensions,
      embeddingPreview: result.embedding.slice(0, 5).map((v) => Math.round(v * 10000) / 10000),
      durationMs: Date.now() - startTime,
    };
  }

  // ═══════════════════════════════════════════════════════
  //  PRODUCT SEARCH (auth required)
  // ═══════════════════════════════════════════════════════

  /** Semantic product search */
  @Post('search')
  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  async search(
    @Body() body: { query: string; limit?: number },
    @Request() req: any,
  ) {
    const storeId = req.user.storeId;
    const startTime = Date.now();
    const { results, method } = await this.productSearch.semanticSearch(
      storeId,
      body.query,
      body.limit || 10,
    );

    return {
      query: body.query,
      method,
      resultCount: results.length,
      results,
      durationMs: Date.now() - startTime,
    };
  }

  /** Natural language query (French-aware) */
  @Post('natural-query')
  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  async naturalQueryEndpoint(
    @Body() body: { query: string; limit?: number },
    @Request() req: any,
  ) {
    return this.naturalQuery.processQuery(req.user.storeId, body.query, body.limit || 10);
  }

  // ═══════════════════════════════════════════════════════
  //  CATALOG SYNC (admin/manager only)
  // ═══════════════════════════════════════════════════════

  /** Sync all products → embeddings in vector store */
  @Post('sync-products')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin', 'manager')
  @Throttle({ default: { limit: 2, ttl: 60000 } })
  async syncProducts(@Request() req: any) {
    const storeId = req.user.storeId;
    return this.productSearch.syncProducts(storeId);
  }

  // ═══════════════════════════════════════════════════════
  //  ASSISTANT (admin/manager only)
  // ═══════════════════════════════════════════════════════

  /** Ask the AI assistant a question about the catalog */
  @Post('assistant')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin', 'manager')
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  async askAssistant(
    @Body() body: { question: string },
    @Request() req: any,
  ) {
    return this.assistant.ask(req.user.storeId, body.question);
  }

  // ═══════════════════════════════════════════════════════
  //  ANOMALY DETECTION (admin/manager only)
  // ═══════════════════════════════════════════════════════

  /** Scan catalog for anomalies */
  @Get('anomalies')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin', 'manager')
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  async scanAnomalies(@Request() req: any) {
    const startTime = Date.now();
    const alerts = await this.anomalyInsights.scanAnomalies(req.user.storeId);
    return {
      totalAlerts: alerts.length,
      alerts,
      durationMs: Date.now() - startTime,
    };
  }

  // ═══════════════════════════════════════════════════════════════
  //  STORE CONTEXT — Intelligence Commerciale IA
  // ═══════════════════════════════════════════════════════════════

  /** Enrich store context via Gemini (location + calendar analysis) */
  @Post('store-context/enrich')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin', 'manager')
  @Throttle({ default: { limit: 2, ttl: 60000 } })
  async enrichStoreContext(@Request() req: any) {
    const startTime = Date.now();
    const result = await this.storeContext.enrichStore(req.user.storeId);
    return { ...result, durationMs: Date.now() - startTime };
  }

  /** Get current store context (location from DB + calendar from cache) */
  @Get('store-context')
  @UseGuards(JwtAuthGuard)
  async getStoreContext(@Request() req: any) {
    const context = await this.storeContext.getContext(req.user.storeId);
    if (!context) {
      return {
        message: 'Store context not yet enriched. Call POST /api/pos-ai/store-context/enrich first.',
        context: null,
      };
    }
    return { context };
  }

  /** Get calendar context only (religious, holidays, cultural events) */
  @Get('store-context/calendar')
  @UseGuards(JwtAuthGuard)
  async getCalendarContext(@Request() req: any) {
    const calendar = await this.storeContext.getCalendarContextByStoreId(req.user.storeId);
    return { calendar };
  }

  /** Force refresh calendar context (clear cache + re-fetch from Gemini) */
  @Post('store-context/calendar/refresh')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin', 'manager')
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  async refreshCalendarContext(@Request() req: any) {
    const startTime = Date.now();
    const calendar = await this.storeContext.refreshCalendarContext(req.user.storeId);
    return { calendar, durationMs: Date.now() - startTime };
  }
}
