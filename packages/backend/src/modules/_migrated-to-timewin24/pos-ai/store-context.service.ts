// ── pos-ai/store-context.service.ts ─────────────────────────────
// Store Context Enrichment — Intelligence Commerciale IA
// Persists location analysis in DB, caches calendar context 24h
// ─────────────────────────────────────────────────────────────────

import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { StoreEntity } from '../../database/entities/store.entity';
import { StoreContextEntity } from '../../database/entities/store-context.entity';
import { GeminiClientService } from './gemini-client';
import { POS_AI_CONFIG } from './config';
import {
  StoreLocationContext,
  CalendarContext,
  StoreContext,
  StoreContextEnrichmentResult,
} from './store-context.types';
import {
  buildLocationAnalysisSystemInstruction,
  buildLocationAnalysisUserPrompt,
  buildCalendarSystemInstruction,
  buildCalendarUserPrompt,
} from './store-context.prompts';

/** In-memory cache entry for calendar context */
interface CalendarCacheEntry {
  data: CalendarContext;
  expiresAt: number;
}

const CALENDAR_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

@Injectable()
export class StoreContextService {
  private readonly logger = new Logger('POS-AI:StoreContext');
  private readonly calendarCache = new Map<string, CalendarCacheEntry>();

  constructor(
    @InjectRepository(StoreContextEntity)
    private readonly contextRepo: Repository<StoreContextEntity>,
    @InjectRepository(StoreEntity)
    private readonly storeRepo: Repository<StoreEntity>,
    private readonly gemini: GeminiClientService,
  ) {}

  // ═══════════════════════════════════════════════════════════════
  //  ENRICHMENT (location analysis via Gemini → DB)
  // ═══════════════════════════════════════════════════════════════

  /**
   * Run Gemini location analysis for a store and persist the result.
   * Also fetches fresh calendar context.
   * Returns the full StoreContext (location + calendar).
   */
  async enrichStore(storeId: string): Promise<StoreContextEnrichmentResult> {
    this.logger.log(`Enriching store context for ${storeId}...`);

    // 1. Load store info
    const store = await this.storeRepo.findOne({ where: { id: storeId } });
    if (!store) {
      throw new Error(`Store ${storeId} not found`);
    }

    // 2. Run Gemini location analysis
    const locationContext = await this.analyzeLocation(store);

    // 3. Persist in DB (upsert)
    let entity = await this.contextRepo.findOne({ where: { storeId } });
    if (entity) {
      entity.locationContext = locationContext;
      entity.locationAnalyzedAt = new Date();
      entity.analysisModel = POS_AI_CONFIG.geminiModel;
    } else {
      entity = this.contextRepo.create({
        storeId,
        locationContext,
        locationAnalyzedAt: new Date(),
        analysisModel: POS_AI_CONFIG.geminiModel,
      });
    }
    await this.contextRepo.save(entity);

    // 4. Get calendar context (fresh)
    const calendarContext = await this.fetchCalendarContext(store);

    const fullContext: StoreContext = {
      ...locationContext,
      calendar_context: calendarContext,
    };

    this.logger.log(`Store context enriched for ${storeId} (model: ${POS_AI_CONFIG.geminiModel})`);

    return {
      storeId,
      context: fullContext,
      locationAnalysisDate: entity.locationAnalyzedAt!.toISOString(),
      calendarGeneratedAt: new Date().toISOString(),
      source: 'gemini',
    };
  }

  // ═══════════════════════════════════════════════════════════════
  //  GET CONTEXT (DB + cache)
  // ═══════════════════════════════════════════════════════════════

  /**
   * Get the full store context (location from DB + calendar from cache/Gemini).
   * Returns null if the store has never been enriched.
   */
  async getContext(storeId: string): Promise<StoreContext | null> {
    // 1. Load persisted location context
    const entity = await this.contextRepo.findOne({ where: { storeId } });
    if (!entity?.locationContext) {
      return null;
    }

    // 2. Get calendar context (cached or fresh)
    const store = await this.storeRepo.findOne({ where: { id: storeId } });
    const calendarContext = store
      ? await this.getCalendarContext(store)
      : this.getDefaultCalendarContext();

    return {
      ...entity.locationContext,
      calendar_context: calendarContext,
    };
  }

  // ═══════════════════════════════════════════════════════════════
  //  CALENDAR CONTEXT (in-memory cache, 24h TTL)
  // ═══════════════════════════════════════════════════════════════

  /**
   * Get calendar context for a store (from cache or Gemini).
   */
  async getCalendarContext(store: StoreEntity): Promise<CalendarContext> {
    const cacheKey = store.id;
    const cached = this.calendarCache.get(cacheKey);

    if (cached && cached.expiresAt > Date.now()) {
      this.logger.debug(`Calendar cache hit for ${store.id}`);
      return cached.data;
    }

    return this.fetchCalendarContext(store);
  }

  /**
   * Get calendar context by storeId (loads store from DB).
   */
  async getCalendarContextByStoreId(storeId: string): Promise<CalendarContext> {
    const store = await this.storeRepo.findOne({ where: { id: storeId } });
    if (!store) {
      throw new Error(`Store ${storeId} not found`);
    }
    return this.getCalendarContext(store);
  }

  /**
   * Force refresh calendar context (clear cache + fetch).
   */
  async refreshCalendarContext(storeId: string): Promise<CalendarContext> {
    const store = await this.storeRepo.findOne({ where: { id: storeId } });
    if (!store) {
      throw new Error(`Store ${storeId} not found`);
    }

    this.calendarCache.delete(storeId);
    return this.fetchCalendarContext(store);
  }

  // ═══════════════════════════════════════════════════════════════
  //  PROMPT HELPER (for assistant injection)
  // ═══════════════════════════════════════════════════════════════

  /**
   * Returns a formatted string for injection into the assistant's Gemini prompt.
   * Returns empty string if context unavailable.
   */
  async getContextForPrompt(storeId: string): Promise<string> {
    try {
      const ctx = await this.getContext(storeId);
      if (!ctx) return '';

      const lines: string[] = [
        `\nContexte commercial du magasin :`,
        `Zone : ${ctx.zone_type}. ${ctx.commercial_environment}.`,
        `Profil trafic : ${ctx.traffic_profile}.`,
        `Clientele dominante : ${ctx.dominant_customer_type}.`,
        `Heures de pointe : ${ctx.peak_hours_estimated.join(', ')}.`,
        `${ctx.operational_summary}`,
      ];

      // Add calendar events if any
      const cal = ctx.calendar_context;
      const allEvents = [
        ...cal.religious_events,
        ...cal.public_holidays,
        ...cal.cultural_events,
      ];
      if (allEvents.length > 0) {
        lines.push(`Evenements calendaires :`);
        for (const evt of allEvents) {
          lines.push(`- ${evt.name} (${evt.type}) : ${evt.impactDescription}`);
        }
      }
      if (cal.school_holidays) {
        lines.push(`Vacances scolaires en cours.`);
      }

      // Competitors summary
      if (ctx.local_competitors.length > 0) {
        lines.push(`Concurrence : ${ctx.local_competitors.map((c) => `${c.name} (${c.type}, ~${c.estimatedDistanceM}m)`).join(', ')}.`);
      }

      return lines.join('\n');
    } catch (err: any) {
      this.logger.debug(`Store context unavailable for prompt: ${err.message}`);
      return '';
    }
  }

  // ═══════════════════════════════════════════════════════════════
  //  PRIVATE — Gemini calls + parsing
  // ═══════════════════════════════════════════════════════════════

  /**
   * Call Gemini to analyze the store's commercial zone.
   */
  private async analyzeLocation(store: StoreEntity): Promise<StoreLocationContext> {
    if (!this.gemini.isAvailable()) {
      throw new Error('Gemini not available — cannot analyze store location');
    }

    const systemInstruction = buildLocationAnalysisSystemInstruction();
    const userPrompt = buildLocationAnalysisUserPrompt({
      name: store.name,
      address: store.address,
      postalCode: store.postalCode,
      city: store.city,
      latitude: store.latitude,
      longitude: store.longitude,
    });

    this.logger.debug(`Location analysis prompt for ${store.name} (${store.city})`);

    const raw = await this.gemini.generate(userPrompt, systemInstruction);
    if (!raw) {
      throw new Error('Gemini returned empty response for location analysis');
    }

    const parsed = this.parseGeminiJson<StoreLocationContext>(raw, {
      zone_type: 'inconnu',
      transport_proximity: 'non analyse',
      commercial_environment: 'non analyse',
      traffic_profile: 'non analyse',
      dominant_customer_type: 'non analyse',
      peak_hours_estimated: [],
      local_competitors: [],
      commercial_attractors: [],
      constraints: [],
      operational_summary: 'Analyse non disponible.',
    });

    this.logger.log(
      `Location analysis complete: zone=${parsed.zone_type}, ` +
      `competitors=${parsed.local_competitors.length}, ` +
      `attractors=${parsed.commercial_attractors.length}`,
    );

    return parsed;
  }

  /**
   * Call Gemini to get calendar context for a store's city.
   */
  private async fetchCalendarContext(store: StoreEntity): Promise<CalendarContext> {
    if (!this.gemini.isAvailable()) {
      this.logger.debug('Gemini not available — returning default calendar');
      return this.getDefaultCalendarContext();
    }

    const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
    const systemInstruction = buildCalendarSystemInstruction();
    const userPrompt = buildCalendarUserPrompt(
      store.city || 'Paris',
      store.postalCode || '75000',
      today,
    );

    this.logger.debug(`Calendar context prompt for ${store.city} (${today})`);

    const raw = await this.gemini.generate(userPrompt, systemInstruction);
    if (!raw) {
      this.logger.warn('Gemini returned empty response for calendar — using default');
      return this.getDefaultCalendarContext();
    }

    const parsed = this.parseGeminiJson<CalendarContext>(raw, this.getDefaultCalendarContext());

    // Cache result
    this.calendarCache.set(store.id, {
      data: parsed,
      expiresAt: Date.now() + CALENDAR_TTL_MS,
    });

    this.logger.log(
      `Calendar context loaded: ` +
      `religious=${parsed.religious_events.length}, ` +
      `holidays=${parsed.public_holidays.length}, ` +
      `school=${parsed.school_holidays}, ` +
      `cultural=${parsed.cultural_events.length}`,
    );

    return parsed;
  }

  /**
   * Parse JSON from Gemini response (handles markdown-wrapped responses).
   */
  private parseGeminiJson<T>(raw: string, fallback: T): T {
    // Attempt 1: direct JSON.parse
    try {
      return JSON.parse(raw) as T;
    } catch {
      // continue
    }

    // Attempt 2: extract from ```json ... ``` block
    const jsonBlockMatch = raw.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
    if (jsonBlockMatch) {
      try {
        return JSON.parse(jsonBlockMatch[1]) as T;
      } catch {
        // continue
      }
    }

    // Attempt 3: find first { ... } or [ ... ] block
    const firstBrace = raw.indexOf('{');
    const lastBrace = raw.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      try {
        return JSON.parse(raw.substring(firstBrace, lastBrace + 1)) as T;
      } catch {
        // continue
      }
    }

    this.logger.warn(`Failed to parse Gemini JSON (${raw.length} chars) — using fallback`);
    return fallback;
  }

  /**
   * Default calendar context when Gemini is unavailable.
   */
  private getDefaultCalendarContext(): CalendarContext {
    return {
      religious_events: [],
      public_holidays: [],
      school_holidays: false,
      cultural_events: [],
    };
  }
}
