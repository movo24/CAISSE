import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';

/* ═══════════════════════════════════════════════════════════════
   EXTERNAL CONTEXT SERVICE — Weather + Transport enrichment

   Fetches real-time external signals to enrich AI recommendations:
   - Weather: temperature, rain, conditions → impact on foot traffic
   - Transport: disruptions, delays → impact on customer flow

   All calls are fail-safe: if API is down, return neutral defaults.
   External data NEVER blocks the POS.
   ═══════════════════════════════════════════════════════════════ */

export interface WeatherContext {
  temperature: number;        // °C
  feelsLike: number;
  condition: string;          // 'clear' | 'clouds' | 'rain' | 'snow' | 'storm'
  humidity: number;           // %
  description: string;        // Human-readable
  impactScore: number;        // -1 (bad for sales) to +1 (good for sales)
  impactReason: string;
  available: boolean;
}

export interface TransportContext {
  stationName: string;
  hasDisruptions: boolean;
  disruptions: { line: string; severity: string; message: string }[];
  estimatedDelay: number;     // minutes
  impactScore: number;        // -1 to +1
  impactReason: string;
  available: boolean;
}

export interface ExternalContext {
  weather: WeatherContext;
  transport: TransportContext;
  fetchedAt: string;
  overallImpact: 'positive' | 'neutral' | 'negative';
}

const WEATHER_CACHE_MS = 15 * 60 * 1000;  // Cache 15 min
const TRANSPORT_CACHE_MS = 5 * 60 * 1000; // Cache 5 min

@Injectable()
export class ExternalContextService {
  private readonly logger = new Logger('ExternalContext');
  private weatherCache: { data: WeatherContext; fetchedAt: number } | null = null;
  private transportCache: { data: TransportContext; fetchedAt: number } | null = null;

  // ── WEATHER (OpenWeatherMap) ──
  async getWeather(lat?: number, lon?: number): Promise<WeatherContext> {
    const neutral: WeatherContext = {
      temperature: 20, feelsLike: 20, condition: 'unknown', humidity: 50,
      description: 'Données météo indisponibles', impactScore: 0,
      impactReason: 'Pas de données météo', available: false,
    };

    // Check cache
    if (this.weatherCache && Date.now() - this.weatherCache.fetchedAt < WEATHER_CACHE_MS) {
      return this.weatherCache.data;
    }

    const apiKey = process.env.OPENWEATHER_API_KEY || process.env.GOOGLE_MAPS_API_KEY;
    if (!apiKey || !lat || !lon) return neutral;

    try {
      const res = await axios.get(
        `https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lon}&appid=${apiKey}&units=metric&lang=fr`,
        { timeout: 5000 },
      );
      const d = res.data;
      const temp = d.main?.temp || 20;
      const condition = d.weather?.[0]?.main?.toLowerCase() || 'unknown';
      const desc = d.weather?.[0]?.description || '';

      // Impact scoring
      let impactScore = 0;
      let impactReason = 'Conditions normales';

      if (condition.includes('rain') || condition.includes('drizzle')) {
        impactScore = -0.3;
        impactReason = 'Pluie — trafic piéton réduit, clients dépannage';
      } else if (condition.includes('snow') || condition.includes('storm')) {
        impactScore = -0.6;
        impactReason = 'Intempéries — forte baisse trafic attendue';
      } else if (temp > 30) {
        impactScore = 0.4;
        impactReason = 'Chaleur — forte demande boissons fraîches';
      } else if (temp < 5) {
        impactScore = -0.2;
        impactReason = 'Froid — clients rapides, paniers plus petits';
      } else if (condition.includes('clear') && temp > 15 && temp < 28) {
        impactScore = 0.3;
        impactReason = 'Beau temps — bon trafic piéton attendu';
      }

      const weather: WeatherContext = {
        temperature: Math.round(temp),
        feelsLike: Math.round(d.main?.feels_like || temp),
        condition,
        humidity: d.main?.humidity || 50,
        description: desc,
        impactScore,
        impactReason,
        available: true,
      };

      this.weatherCache = { data: weather, fetchedAt: Date.now() };
      return weather;
    } catch (err: any) {
      this.logger.warn(`Weather API failed: ${err.message}`);
      return neutral;
    }
  }

  // ── TRANSPORT (PRIM / Île-de-France Mobilités) ──
  async getTransport(stationName?: string): Promise<TransportContext> {
    const neutral: TransportContext = {
      stationName: stationName || 'unknown',
      hasDisruptions: false, disruptions: [], estimatedDelay: 0,
      impactScore: 0, impactReason: 'Pas de données transport',
      available: false,
    };

    if (this.transportCache && Date.now() - this.transportCache.fetchedAt < TRANSPORT_CACHE_MS) {
      return this.transportCache.data;
    }

    const apiKey = process.env.PRIM_API_KEY;
    if (!apiKey || !stationName) return neutral;

    try {
      // PRIM API — Île-de-France Mobilités general disruptions
      const res = await axios.get(
        'https://prim.iledefrance-mobilites.fr/marketplace/general-message',
        {
          headers: { apiKey },
          timeout: 5000,
        },
      );

      const messages = res.data?.Siri?.ServiceDelivery?.GeneralMessageDelivery?.[0]?.InfoMessage || [];
      const disruptions = messages
        .filter((m: any) => m.Content?.Message?.[0]?.MessageText?.value)
        .slice(0, 5)
        .map((m: any) => ({
          line: m.InfoChannelRef?.value || 'Réseau',
          severity: m.InfoMessageVersion?.[0]?.Content?.Severity || 'unknown',
          message: m.Content?.Message?.[0]?.MessageText?.value || '',
        }));

      const hasDisruptions = disruptions.length > 0;
      const estimatedDelay = hasDisruptions ? 10 : 0; // Rough estimate

      let impactScore = 0;
      let impactReason = 'Transport normal';

      if (disruptions.length >= 3) {
        impactScore = 0.4; // Major disruption → people stuck → impulse buying
        impactReason = `${disruptions.length} perturbations — clients bloqués, achats d'impulsion`;
      } else if (disruptions.length >= 1) {
        impactScore = 0.1;
        impactReason = 'Perturbations légères — flux modifié';
      }

      const transport: TransportContext = {
        stationName: stationName || 'Île-de-France',
        hasDisruptions,
        disruptions,
        estimatedDelay,
        impactScore,
        impactReason,
        available: true,
      };

      this.transportCache = { data: transport, fetchedAt: Date.now() };
      return transport;
    } catch (err: any) {
      this.logger.warn(`Transport API failed: ${err.message}`);
      return neutral;
    }
  }

  // ── COMBINED CONTEXT ──
  async getFullContext(lat?: number, lon?: number, stationName?: string): Promise<ExternalContext> {
    const [weather, transport] = await Promise.all([
      this.getWeather(lat, lon),
      this.getTransport(stationName),
    ]);

    const combinedImpact = weather.impactScore + transport.impactScore;
    let overallImpact: 'positive' | 'neutral' | 'negative' = 'neutral';
    if (combinedImpact > 0.2) overallImpact = 'positive';
    else if (combinedImpact < -0.2) overallImpact = 'negative';

    return {
      weather,
      transport,
      fetchedAt: new Date().toISOString(),
      overallImpact,
    };
  }
}
