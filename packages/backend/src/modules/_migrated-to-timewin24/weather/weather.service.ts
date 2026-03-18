// ── weather/weather.service.ts ───────────────────────────────────
// Main weather orchestration service
// Handles: provider selection, caching, categorization, snapshots
// ─────────────────────────────────────────────────────────────────

import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { StoreEntity } from '../../database/entities/store.entity';
import { JackpotConfigEntity } from '../../database/entities/jackpot-config.entity';
import { OpenMeteoProvider } from './providers/open-meteo.provider';
import { OpenWeatherProvider } from './providers/openweather.provider';
import { WeatherProviderConfig, RawWeatherData } from './weather-provider.interface';
import { WeatherRules } from './weather-rules';
import { CircuitBreaker } from '../../common/resilience/circuit-breaker';
import {
  BusinessWeatherCategory,
  WeatherCondition,
  WeatherForecast,
  WeatherResponse,
  WeatherSnapshot,
  LegacyWeatherData,
} from './types';

@Injectable()
export class WeatherService {
  private readonly logger = new Logger('Weather');

  /** 30-minute cache per store */
  private readonly cache = new Map<
    string,
    { data: WeatherResponse; expiresAt: number }
  >();
  private static readonly CACHE_TTL_MS = 30 * 60 * 1000; // 30 min

  /** Last snapshot per store (for event correlation) */
  private readonly snapshots = new Map<string, WeatherSnapshot>();

  /** Circuit breakers for each provider */
  private readonly openWeatherCB = new CircuitBreaker('OpenWeather', {
    failureThreshold: 3,
    cooldownMs: 60_000,
    timeoutMs: 8_000,
    retryAttempts: 2,
    retryDelayMs: 1_000,
  });
  private readonly openMeteoCB = new CircuitBreaker('OpenMeteo', {
    failureThreshold: 5,
    cooldownMs: 30_000,
    timeoutMs: 8_000,
    retryAttempts: 2,
    retryDelayMs: 1_000,
  });

  constructor(
    @InjectRepository(StoreEntity)
    private readonly storeRepo: Repository<StoreEntity>,
    @InjectRepository(JackpotConfigEntity)
    private readonly configRepo: Repository<JackpotConfigEntity>,
    private readonly openMeteo: OpenMeteoProvider,
    private readonly openWeather: OpenWeatherProvider,
  ) {}

  // ─────────────────────────────────────────────────────────────
  // Public API
  // ─────────────────────────────────────────────────────────────

  /**
   * Get full weather data for a store (cached 30 min)
   */
  async getWeather(storeId: string): Promise<WeatherResponse | null> {
    // 1. Check cache
    const cached = this.cache.get(storeId);
    if (cached && cached.expiresAt > Date.now()) {
      this.logger.debug(`Cache hit for store ${storeId}`);
      return cached.data;
    }

    // 2. Resolve provider config
    const providerConfig = await this.resolveProviderConfig(storeId);
    if (!providerConfig) {
      this.logger.warn(`No location data for store ${storeId} — cannot fetch weather`);
      return this.returnStaleOrNull(storeId);
    }

    // 3. Fetch from provider
    try {
      const { raw, providerName } = await this.fetchFromProvider(providerConfig, storeId);

      // 4. Build response
      const response = this.buildResponse(raw, providerName, providerConfig.city || 'Inconnu');

      // 5. Cache
      this.cache.set(storeId, {
        data: response,
        expiresAt: Date.now() + WeatherService.CACHE_TTL_MS,
      });

      // 6. Save snapshot
      this.snapshots.set(storeId, {
        storeId,
        timestamp: new Date().toISOString(),
        current: response.current,
        businessCategory: response.current.businessCategory,
        trafficImpact: response.trafficImpact,
      });

      this.logger.log(
        `Weather updated: store=${storeId} ` +
        `provider=${providerName} temp=${response.current.temp}°C ` +
        `category=${response.current.businessCategory}`,
      );

      return response;
    } catch (err: any) {
      this.logger.error(`Weather fetch failed for store ${storeId}: ${err.message}`);
      return this.returnStaleOrNull(storeId);
    }
  }

  /**
   * Get the latest weather snapshot for event correlation
   */
  getSnapshot(storeId: string): WeatherSnapshot | null {
    return this.snapshots.get(storeId) || null;
  }

  /**
   * Convert to legacy format for backward compat with FluxWidget
   */
  toLegacyFormat(response: WeatherResponse): LegacyWeatherData {
    return {
      icon: response.current.icon,
      temp: response.current.temp,
      description: response.current.condition,
      cachedAt: new Date(response.cachedAt),
    };
  }

  // ─────────────────────────────────────────────────────────────
  // Provider Resolution
  // ─────────────────────────────────────────────────────────────

  private async resolveProviderConfig(
    storeId: string,
  ): Promise<(WeatherProviderConfig & { preferOpenWeather: boolean }) | null> {
    // Fetch store + jackpot config in parallel
    const [store, config] = await Promise.all([
      this.storeRepo.findOne({ where: { id: storeId } }),
      this.configRepo.findOne({ where: { storeId, isActive: true } }),
    ]);

    if (!store) return null;

    const hasCoords = store.latitude != null && store.longitude != null;
    const hasOpenWeatherKey = !!(config?.openWeatherApiKey);
    const city = config?.openWeatherCity || store.city || null;

    // Need at least coordinates or city
    if (!hasCoords && !city) return null;

    // Default Paris coordinates if no coords but city available
    const latitude = hasCoords ? Number(store.latitude) : 48.8566;
    const longitude = hasCoords ? Number(store.longitude) : 2.3522;

    return {
      latitude,
      longitude,
      apiKey: config?.openWeatherApiKey || undefined,
      city: city || undefined,
      preferOpenWeather: hasOpenWeatherKey,
    };
  }

  private async fetchFromProvider(
    config: WeatherProviderConfig & { preferOpenWeather: boolean },
    storeId: string,
  ): Promise<{ raw: RawWeatherData; providerName: 'open-meteo' | 'openweather' }> {
    // Try preferred provider first (with circuit breaker), fallback to the other
    if (config.preferOpenWeather) {
      try {
        const raw = await this.openWeatherCB.execute(
          () => this.openWeather.fetch(config),
        );
        return { raw, providerName: 'openweather' };
      } catch (err: any) {
        const cbState = this.openWeatherCB.getState();
        this.logger.warn(
          `OpenWeather failed for store ${storeId} (circuit: ${cbState.state}): ${err.message} — falling back to Open-Meteo`,
        );
      }
    }

    // Open-Meteo (default / fallback) — also protected by circuit breaker
    const raw = await this.openMeteoCB.execute(
      () => this.openMeteo.fetch(config),
    );
    return { raw, providerName: 'open-meteo' };
  }

  // ─────────────────────────────────────────────────────────────
  // Response Building
  // ─────────────────────────────────────────────────────────────

  private buildResponse(
    raw: RawWeatherData,
    providerName: 'open-meteo' | 'openweather',
    city: string,
  ): WeatherResponse {
    const category = this.categorize(raw);

    const current: WeatherCondition = {
      temp: Math.round(raw.temp * 10) / 10,
      feelsLike: Math.round(raw.feelsLike * 10) / 10,
      humidity: Math.round(raw.humidity),
      windSpeed: Math.round(raw.windSpeed * 3.6 * 10) / 10, // m/s → km/h
      windGust: raw.windGust ? Math.round(raw.windGust * 3.6 * 10) / 10 : null,
      isRaining: raw.rainMm > 0.1,
      rainIntensity: Math.round(raw.rainMm * 10) / 10,
      condition: raw.conditionText,
      conditionCode: raw.conditionCode,
      icon: raw.icon,
      businessCategory: category,
    };

    // Build forecast3h (next 3 entries ~1h apart, or 3h entries)
    const forecast3h: WeatherForecast[] = raw.hourlyForecast
      .slice(0, 3)
      .map((h) => ({
        time: h.time,
        temp: Math.round(h.temp * 10) / 10,
        feelsLike: Math.round(h.feelsLike * 10) / 10,
        isRaining: h.rainMm > 0.1,
        rainIntensity: Math.round(h.rainMm * 10) / 10,
        condition: h.conditionText,
        businessCategory: this.categorizeFromHourly(h),
      }));

    // Build forecastDay (all entries)
    const forecastDay: WeatherForecast[] = raw.hourlyForecast
      .map((h) => ({
        time: h.time,
        temp: Math.round(h.temp * 10) / 10,
        feelsLike: Math.round(h.feelsLike * 10) / 10,
        isRaining: h.rainMm > 0.1,
        rainIntensity: Math.round(h.rainMm * 10) / 10,
        condition: h.conditionText,
        businessCategory: this.categorizeFromHourly(h),
      }));

    const recommendations = WeatherRules.getRecommendations(category, raw.temp);
    const trafficImpact = WeatherRules.getTrafficImpact(category, raw.temp);

    return {
      current,
      forecast3h,
      forecastDay,
      recommendations,
      trafficImpact,
      provider: providerName,
      cachedAt: new Date().toISOString(),
      storeCity: city,
    };
  }

  // ─────────────────────────────────────────────────────────────
  // Business Categorization
  // ─────────────────────────────────────────────────────────────

  /**
   * Map raw weather data to a business category
   * Priority: heavy_rain > rain > wind > hot > cold > cloudy > clear
   */
  private categorize(raw: RawWeatherData): BusinessWeatherCategory {
    if (raw.rainMm >= 7) return 'heavy_rain';
    if (raw.rainMm > 0.5) return 'rain';

    const windKmh = raw.windSpeed * 3.6;
    if (windKmh >= 50) return 'wind';

    if (raw.temp >= 30) return 'hot';
    if (raw.temp <= 5) return 'cold';

    // WMO codes 2-3 = cloudy, OpenWeather 80x = clouds
    if (this.isCloudyCode(raw.conditionCode)) return 'cloudy';

    return 'clear';
  }

  private categorizeFromHourly(
    h: { temp: number; rainMm: number; conditionCode: number },
  ): BusinessWeatherCategory {
    if (h.rainMm >= 7) return 'heavy_rain';
    if (h.rainMm > 0.5) return 'rain';
    if (h.temp >= 30) return 'hot';
    if (h.temp <= 5) return 'cold';
    if (this.isCloudyCode(h.conditionCode)) return 'cloudy';
    return 'clear';
  }

  private isCloudyCode(code: number): boolean {
    // WMO: 2 = partly cloudy, 3 = overcast, 45/48 = fog
    // OpenWeather: 802-804 = clouds
    return [2, 3, 45, 48].includes(code) || (code >= 802 && code <= 804);
  }

  // ─────────────────────────────────────────────────────────────
  // Cache helpers
  // ─────────────────────────────────────────────────────────────

  private returnStaleOrNull(storeId: string): WeatherResponse | null {
    const cached = this.cache.get(storeId);
    if (cached) {
      this.logger.warn(`Returning stale cache for store ${storeId}`);
      return cached.data;
    }
    return null;
  }
}
