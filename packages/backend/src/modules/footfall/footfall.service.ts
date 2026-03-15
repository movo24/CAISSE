// ── footfall/footfall.service.ts ─────────────────────────────────
// Main footfall context service
// Discovers nearby places, computes traffic score, caches 1h
// ─────────────────────────────────────────────────────────────────

import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { StoreEntity } from '../../database/entities/store.entity';
import { StoreContextEntity } from '../../database/entities/store-context.entity';
import { FootfallClient, GooglePlaceResult } from './footfall-client';
import {
  TrafficLevel,
  PlaceCategory,
  NearbyPlace,
  FootfallContext,
  StoreFootfallConfig,
  FootfallCacheEntry,
} from './footfall.types';

const FOOTFALL_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
const AUTO_REFRESH_INTERVAL_MS = 60 * 60 * 1000; // 1 hour
const DEFAULT_RADIUS_M = 500;
const TOP_PLACES_COUNT = 10;

@Injectable()
export class FootfallService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('Footfall:Service');

  /** Footfall context cache: storeId -> { data, expiresAt } */
  private readonly cache = new Map<string, FootfallCacheEntry>();

  /** In-memory place configs: storeId -> StoreFootfallConfig */
  private readonly placeConfigs = new Map<string, StoreFootfallConfig>();

  /** Auto-refresh interval handle */
  private refreshInterval: ReturnType<typeof setInterval> | null = null;

  constructor(
    @InjectRepository(StoreEntity)
    private readonly storeRepo: Repository<StoreEntity>,
    @InjectRepository(StoreContextEntity)
    private readonly contextRepo: Repository<StoreContextEntity>,
    private readonly placesClient: FootfallClient,
  ) {}

  // ═══════════════════════════════════════════════════════════════
  //  LIFECYCLE
  // ═══════════════════════════════════════════════════════════════

  async onModuleInit() {
    // Load persisted footfall configs from DB
    await this.loadPlaceConfigs();

    // Start auto-refresh
    if (this.placesClient.isAvailable()) {
      this.refreshInterval = setInterval(
        () => this.refreshAllStores(),
        AUTO_REFRESH_INTERVAL_MS,
      );
      this.logger.log(
        `Footfall service initialized — ${this.placeConfigs.size} store(s) configured, auto-refresh every 1h`,
      );
    } else {
      this.logger.warn(
        'GOOGLE_MAPS_API_KEY not configured — footfall features disabled',
      );
    }
  }

  onModuleDestroy() {
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
      this.refreshInterval = null;
    }
  }

  // ═══════════════════════════════════════════════════════════════
  //  PLACE DISCOVERY (Google Places → persist)
  // ═══════════════════════════════════════════════════════════════

  /**
   * Discover nearby places for a store using Google Places API.
   * Persists results in StoreContextEntity.footfallConfig.
   */
  async discoverPlaces(
    storeId: string,
    radiusM = DEFAULT_RADIUS_M,
  ): Promise<FootfallContext> {
    const store = await this.storeRepo.findOne({ where: { id: storeId } });
    if (!store) {
      throw new Error(`Store ${storeId} not found`);
    }

    if (!store.latitude || !store.longitude) {
      throw new Error(
        `Store ${storeId} has no GPS coordinates — cannot discover nearby places`,
      );
    }

    this.logger.log(
      `Discovering nearby places for ${store.name} (${store.latitude}, ${store.longitude}, radius=${radiusM}m)`,
    );

    const rawPlaces = await this.placesClient.fetchNearbyPlaces(
      Number(store.latitude),
      Number(store.longitude),
      radiusM,
    );

    const places = this.parseGooglePlaces(
      rawPlaces,
      Number(store.latitude),
      Number(store.longitude),
    );

    this.logger.log(
      `Found ${places.length} nearby place(s) for ${store.name}`,
    );

    // Persist in DB
    const config: StoreFootfallConfig = {
      storeId,
      places,
      radiusM,
      discoveredAt: new Date().toISOString(),
    };

    const existing = await this.contextRepo.findOne({ where: { storeId } });
    if (existing) {
      existing.footfallConfig = config;
      await this.contextRepo.save(existing);
    } else {
      const newEntity = this.contextRepo.create({
        storeId,
        footfallConfig: config,
      });
      await this.contextRepo.save(newEntity);
    }

    // Update in-memory config
    this.placeConfigs.set(storeId, config);

    // Build and cache context
    const ctx = this.buildFootfallContext(places, radiusM);
    this.cache.set(storeId, {
      data: ctx,
      expiresAt: Date.now() + FOOTFALL_CACHE_TTL_MS,
    });

    return ctx;
  }

  // ═══════════════════════════════════════════════════════════════
  //  FOOTFALL CONTEXT (cache + compute)
  // ═══════════════════════════════════════════════════════════════

  /**
   * Get footfall context for a store.
   * Returns cached data if fresh, or recomputes.
   * Returns null if no places configured.
   */
  async getFootfallContext(storeId: string): Promise<FootfallContext | null> {
    const config = this.placeConfigs.get(storeId);
    if (!config || config.places.length === 0) {
      return null;
    }

    // Check cache
    const cached = this.cache.get(storeId);
    if (cached && cached.expiresAt > Date.now()) {
      this.logger.debug(`Footfall cache hit for ${storeId}`);
      return cached.data;
    }

    // Rebuild from persisted places (no API call needed for score)
    const ctx = this.buildFootfallContext(config.places, config.radiusM);
    this.cache.set(storeId, {
      data: ctx,
      expiresAt: Date.now() + FOOTFALL_CACHE_TTL_MS,
    });

    return ctx;
  }

  /**
   * Force refresh: re-fetch from Google Places API and rebuild context.
   */
  async refreshFootfall(storeId: string): Promise<FootfallContext> {
    const config = this.placeConfigs.get(storeId);
    const radiusM = config?.radiusM || DEFAULT_RADIUS_M;

    // Clear cache to force re-discovery
    this.cache.delete(storeId);
    return this.discoverPlaces(storeId, radiusM);
  }

  // ═══════════════════════════════════════════════════════════════
  //  PROMPT HELPER (for assistant injection)
  // ═══════════════════════════════════════════════════════════════

  /**
   * Returns a formatted string for injection into the assistant's prompt.
   * Returns empty string if footfall context unavailable.
   */
  async getContextForPrompt(storeId: string): Promise<string> {
    try {
      const ctx = await this.getFootfallContext(storeId);
      if (!ctx) return '';

      const levelLabels: Record<TrafficLevel, string> = {
        low: 'faible',
        medium: 'moyen',
        high: 'eleve',
      };

      const lines: string[] = [
        `\nContexte affluence :`,
        `Score affluence : ${ctx.footfallScore}/100 (${levelLabels[ctx.nearbyTrafficLevel]}).`,
        `${ctx.totalNearbyPlaces} lieu(x) a proximite, ${ctx.totalUserRatings} avis cumules.`,
      ];

      // Category highlights
      const topCategories = Object.entries(ctx.categoryBreakdown)
        .filter(([, count]) => count > 0)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5);

      if (topCategories.length > 0) {
        lines.push(
          `Types dominants : ${topCategories.map(([cat, n]) => `${cat} (${n})`).join(', ')}.`,
        );
      }

      // Top 3 traffic generators
      if (ctx.topPlaces.length > 0) {
        lines.push(`Generateurs de trafic principaux :`);
        for (const p of ctx.topPlaces.slice(0, 3)) {
          const ratingStr = p.rating ? ` ${p.rating}/5` : '';
          lines.push(
            `- ${p.name} (${p.category}, ${p.userRatingsTotal} avis${ratingStr}, ${p.distanceM}m)`,
          );
        }
      }

      return lines.join('\n');
    } catch (err: any) {
      this.logger.debug(
        `Footfall context unavailable for prompt: ${err.message}`,
      );
      return '';
    }
  }

  /** Is the Google Places API configured? */
  isAvailable(): boolean {
    return this.placesClient.isAvailable();
  }

  // ═══════════════════════════════════════════════════════════════
  //  PRIVATE — Score computation
  // ═══════════════════════════════════════════════════════════════

  /**
   * Build FootfallContext from a list of places.
   * Score is computed from:
   *   - Number of nearby places (density)
   *   - Total user_ratings_total (proxy for visitor volume)
   *   - Business status (operational vs closed)
   *   - Ratings (higher = more popular)
   *   - Place types (restaurants/cafes = more foot traffic)
   */
  private buildFootfallContext(
    places: NearbyPlace[],
    radiusM: number,
  ): FootfallContext {
    const activePlaces = places.filter(
      (p) => p.businessStatus === 'OPERATIONAL',
    );

    // ── Metrics ──
    const totalUserRatings = activePlaces.reduce(
      (sum, p) => sum + p.userRatingsTotal,
      0,
    );
    const avgRating =
      activePlaces.length > 0
        ? activePlaces.reduce((sum, p) => sum + (p.rating || 0), 0) /
          activePlaces.filter((p) => p.rating !== null).length || 0
        : 0;

    // ── Category breakdown ──
    const categoryBreakdown = {} as Record<PlaceCategory, number>;
    const allCategories: PlaceCategory[] = [
      'restaurant', 'cafe', 'bar', 'shop', 'supermarket', 'school',
      'hospital', 'transport', 'park', 'gym', 'entertainment', 'office', 'other',
    ];
    for (const cat of allCategories) {
      categoryBreakdown[cat] = 0;
    }
    for (const p of activePlaces) {
      categoryBreakdown[p.category] = (categoryBreakdown[p.category] || 0) + 1;
    }

    // ── Score computation (0-100) ──
    const score = this.computeFootfallScore(activePlaces, totalUserRatings);
    const trafficLevel = this.scoreToLevel(score);

    // ── Top places by traffic ──
    const topPlaces = [...activePlaces]
      .sort((a, b) => b.userRatingsTotal - a.userRatingsTotal)
      .slice(0, TOP_PLACES_COUNT);

    return {
      footfallScore: score,
      nearbyTrafficLevel: trafficLevel,
      totalNearbyPlaces: activePlaces.length,
      totalUserRatings,
      averageRating: Math.round(avgRating * 10) / 10,
      categoryBreakdown,
      topPlaces,
      allPlaces: places,
      updatedAt: new Date().toISOString(),
      radiusM,
    };
  }

  /**
   * Compute a 0-100 footfall score.
   *
   * Components:
   *   1. Density score (0-30): number of active places in radius
   *   2. Volume score (0-40): total user ratings (proxy for visits)
   *   3. Diversity score (0-15): variety of place categories
   *   4. Quality score (0-15): average rating weighted by count
   */
  private computeFootfallScore(
    places: NearbyPlace[],
    totalRatings: number,
  ): number {
    // 1. Density: 0-30 points
    //    0 places = 0, 5 places = 10, 15 places = 20, 30+ = 30
    const densityScore = Math.min(30, Math.round((places.length / 30) * 30));

    // 2. Volume: 0-40 points
    //    Based on total user ratings (proxy for visitor volume)
    //    0 = 0, 500 = 10, 2000 = 20, 5000 = 30, 10000+ = 40
    const volumeScore = Math.min(
      40,
      Math.round(Math.log10(Math.max(1, totalRatings)) * 10),
    );

    // 3. Diversity: 0-15 points
    //    How many different categories are represented
    const uniqueCategories = new Set(places.map((p) => p.category)).size;
    const diversityScore = Math.min(15, uniqueCategories * 2);

    // 4. Quality: 0-15 points
    //    High-rated places attract more visitors
    const ratedPlaces = places.filter((p) => p.rating !== null && p.rating > 0);
    const avgRating =
      ratedPlaces.length > 0
        ? ratedPlaces.reduce((s, p) => s + (p.rating || 0), 0) / ratedPlaces.length
        : 0;
    const qualityScore = Math.min(15, Math.round((avgRating / 5) * 15));

    const total = densityScore + volumeScore + diversityScore + qualityScore;
    return Math.min(100, Math.max(0, total));
  }

  /** Convert numeric score to traffic level bucket */
  private scoreToLevel(score: number): TrafficLevel {
    if (score >= 60) return 'high';
    if (score >= 30) return 'medium';
    return 'low';
  }

  // ═══════════════════════════════════════════════════════════════
  //  PRIVATE — Parse Google Places response
  // ═══════════════════════════════════════════════════════════════

  /**
   * Parse Google Places results into NearbyPlace[]
   */
  private parseGooglePlaces(
    results: GooglePlaceResult[],
    storeLat: number,
    storeLon: number,
  ): NearbyPlace[] {
    return results.map((r) => ({
      placeId: r.place_id,
      name: r.name,
      category: this.mapPlaceCategory(r.types),
      types: r.types,
      distanceM: this.haversineDistance(
        storeLat,
        storeLon,
        r.geometry.location.lat,
        r.geometry.location.lng,
      ),
      rating: r.rating ?? null,
      userRatingsTotal: r.user_ratings_total || 0,
      businessStatus: r.business_status || 'OPERATIONAL',
      vicinity: r.vicinity || '',
      coord: {
        lat: r.geometry.location.lat,
        lon: r.geometry.location.lng,
      },
    }));
  }

  /**
   * Map Google Places types array to a single PlaceCategory
   */
  private mapPlaceCategory(types: string[]): PlaceCategory {
    const t = new Set(types);

    if (t.has('restaurant') || t.has('meal_delivery') || t.has('meal_takeaway'))
      return 'restaurant';
    if (t.has('cafe')) return 'cafe';
    if (t.has('bar') || t.has('night_club')) return 'bar';
    if (t.has('supermarket') || t.has('grocery_or_supermarket'))
      return 'supermarket';
    if (
      t.has('clothing_store') ||
      t.has('shoe_store') ||
      t.has('shopping_mall') ||
      t.has('store') ||
      t.has('electronics_store') ||
      t.has('furniture_store') ||
      t.has('hardware_store') ||
      t.has('home_goods_store') ||
      t.has('jewelry_store') ||
      t.has('book_store') ||
      t.has('pet_store') ||
      t.has('convenience_store')
    )
      return 'shop';
    if (t.has('school') || t.has('university') || t.has('secondary_school') || t.has('primary_school'))
      return 'school';
    if (t.has('hospital') || t.has('doctor') || t.has('pharmacy') || t.has('dentist'))
      return 'hospital';
    if (
      t.has('transit_station') ||
      t.has('bus_station') ||
      t.has('subway_station') ||
      t.has('train_station')
    )
      return 'transport';
    if (t.has('park') || t.has('amusement_park')) return 'park';
    if (t.has('gym') || t.has('spa')) return 'gym';
    if (
      t.has('movie_theater') ||
      t.has('museum') ||
      t.has('art_gallery') ||
      t.has('bowling_alley') ||
      t.has('casino') ||
      t.has('stadium')
    )
      return 'entertainment';
    if (t.has('accounting') || t.has('insurance_agency') || t.has('lawyer') || t.has('real_estate_agency'))
      return 'office';

    return 'other';
  }

  /**
   * Haversine distance between two GPS coordinates (meters)
   */
  private haversineDistance(
    lat1: number,
    lon1: number,
    lat2: number,
    lon2: number,
  ): number {
    const R = 6371000; // Earth's radius in meters
    const dLat = this.toRad(lat2 - lat1);
    const dLon = this.toRad(lon2 - lon1);
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(this.toRad(lat1)) *
        Math.cos(this.toRad(lat2)) *
        Math.sin(dLon / 2) *
        Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return Math.round(R * c);
  }

  private toRad(deg: number): number {
    return (deg * Math.PI) / 180;
  }

  // ═══════════════════════════════════════════════════════════════
  //  PRIVATE — DB / Auto-refresh
  // ═══════════════════════════════════════════════════════════════

  /**
   * Load footfall configs from DB into memory at startup.
   */
  private async loadPlaceConfigs(): Promise<void> {
    try {
      const entities = await this.contextRepo.find({
        where: {},
        select: ['storeId', 'footfallConfig' as any],
      });

      let count = 0;
      for (const entity of entities) {
        const config = (entity as any).footfallConfig;
        if (config) {
          this.placeConfigs.set(entity.storeId, config);
          count++;
        }
      }

      this.logger.debug(`Loaded ${count} footfall config(s) from DB`);
    } catch (err: any) {
      this.logger.warn(`Failed to load footfall configs: ${err.message}`);
    }
  }

  /**
   * Auto-refresh: re-compute footfall for all configured stores.
   * Note: Does NOT re-fetch from Google API (saves quota).
   * Use manual refresh endpoint to re-fetch from Google.
   */
  private async refreshAllStores(): Promise<void> {
    if (this.placeConfigs.size === 0) return;

    this.logger.debug(
      `Auto-refreshing footfall for ${this.placeConfigs.size} store(s)...`,
    );

    for (const [storeId, config] of this.placeConfigs) {
      try {
        const ctx = this.buildFootfallContext(config.places, config.radiusM);
        this.cache.set(storeId, {
          data: ctx,
          expiresAt: Date.now() + FOOTFALL_CACHE_TTL_MS,
        });
      } catch (err: any) {
        this.logger.debug(
          `Auto-refresh failed for ${storeId}: ${err.message}`,
        );
      }
    }
  }
}
