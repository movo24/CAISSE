// ── weather/providers/openweather.provider.ts ────────────────────
// OpenWeatherMap provider — requires API key, supports city or lat/lng
// https://openweathermap.org/current + https://openweathermap.org/forecast5
// ─────────────────────────────────────────────────────────────────

import { Injectable, Logger } from '@nestjs/common';
import {
  WeatherProvider,
  WeatherProviderConfig,
  RawWeatherData,
  RawHourlyEntry,
} from '../weather-provider.interface';

@Injectable()
export class OpenWeatherProvider implements WeatherProvider {
  private readonly logger = new Logger('Weather:OpenWeather');
  readonly name = 'openweather' as const;

  async fetch(config: WeatherProviderConfig): Promise<RawWeatherData> {
    if (!config.apiKey) {
      throw new Error('OpenWeather API key is required');
    }

    // Fetch current weather + 5-day forecast in parallel
    const [current, forecast] = await Promise.all([
      this.fetchCurrent(config),
      this.fetchForecast(config),
    ]);

    return {
      ...current,
      hourlyForecast: forecast,
    };
  }

  private async fetchCurrent(
    config: WeatherProviderConfig,
  ): Promise<Omit<RawWeatherData, 'hourlyForecast'>> {
    const params = new URLSearchParams({
      appid: config.apiKey!,
      units: 'metric',
      lang: 'fr',
    });

    // Prefer lat/lng, fallback to city
    if (config.latitude && config.longitude) {
      params.set('lat', config.latitude.toString());
      params.set('lon', config.longitude.toString());
    } else if (config.city) {
      params.set('q', config.city);
    } else {
      throw new Error('OpenWeather requires latitude/longitude or city');
    }

    const url = `https://api.openweathermap.org/data/2.5/weather?${params}`;
    this.logger.debug(`Fetching current: ${url.replace(config.apiKey!, '***')}`);

    const json = await this.fetchWithTimeout(url);

    const rain = json.rain?.['1h'] ?? json.rain?.['3h'] ?? 0;

    return {
      temp: json.main?.temp ?? 0,
      feelsLike: json.main?.feels_like ?? json.main?.temp ?? 0,
      humidity: json.main?.humidity ?? 0,
      windSpeed: json.wind?.speed ?? 0, // already in m/s
      windGust: json.wind?.gust ?? null,
      conditionCode: json.weather?.[0]?.id ?? 800,
      conditionText: json.weather?.[0]?.description ?? '',
      icon: json.weather?.[0]?.icon ?? '01d',
      rainMm: rain,
    };
  }

  private async fetchForecast(
    config: WeatherProviderConfig,
  ): Promise<RawHourlyEntry[]> {
    const params = new URLSearchParams({
      appid: config.apiKey!,
      units: 'metric',
      lang: 'fr',
      cnt: '8', // 8 * 3h = 24h forecast
    });

    if (config.latitude && config.longitude) {
      params.set('lat', config.latitude.toString());
      params.set('lon', config.longitude.toString());
    } else if (config.city) {
      params.set('q', config.city);
    }

    const url = `https://api.openweathermap.org/data/2.5/forecast?${params}`;
    this.logger.debug(`Fetching forecast: ${url.replace(config.apiKey!, '***')}`);

    try {
      const json = await this.fetchWithTimeout(url);
      const list = json.list || [];

      return list.map((entry: any) => ({
        time: new Date(entry.dt * 1000).toISOString(),
        temp: entry.main?.temp ?? 0,
        feelsLike: entry.main?.feels_like ?? entry.main?.temp ?? 0,
        conditionCode: entry.weather?.[0]?.id ?? 800,
        conditionText: entry.weather?.[0]?.description ?? '',
        rainMm: entry.rain?.['3h'] ?? 0,
      }));
    } catch (err: any) {
      // Forecast failure is non-critical — return empty
      this.logger.warn(`Forecast fetch failed: ${err.message}`);
      return [];
    }
  }

  private async fetchWithTimeout(url: string): Promise<any> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    try {
      const response = await fetch(url, { signal: controller.signal });
      clearTimeout(timeout);

      if (!response.ok) {
        throw new Error(`OpenWeather HTTP ${response.status}: ${response.statusText}`);
      }

      return response.json();
    } catch (err: any) {
      clearTimeout(timeout);
      if (err.name === 'AbortError') {
        throw new Error('OpenWeather request timed out (5s)');
      }
      throw err;
    }
  }
}
