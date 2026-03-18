// ── weather/providers/open-meteo.provider.ts ─────────────────────
// Free weather provider — no API key required, uses lat/lng
// https://open-meteo.com/en/docs
// ─────────────────────────────────────────────────────────────────

import { Injectable, Logger } from '@nestjs/common';
import {
  WeatherProvider,
  WeatherProviderConfig,
  RawWeatherData,
  RawHourlyEntry,
} from '../weather-provider.interface';

/**
 * WMO Weather Code → French description + icon mapping
 * https://www.nodc.noaa.gov/archive/arc0021/0002199/1.1/data/0-data/HTML/WMO-CODE/WMO4677.HTM
 */
const WMO_CODES: Record<number, { text: string; icon: string }> = {
  0:  { text: 'Ciel degageé', icon: '01d' },
  1:  { text: 'Principalement degageé', icon: '01d' },
  2:  { text: 'Partiellement nuageux', icon: '02d' },
  3:  { text: 'Couvert', icon: '04d' },
  45: { text: 'Brouillard', icon: '50d' },
  48: { text: 'Brouillard givrant', icon: '50d' },
  51: { text: 'Bruine legere', icon: '09d' },
  53: { text: 'Bruine moderee', icon: '09d' },
  55: { text: 'Bruine dense', icon: '09d' },
  56: { text: 'Bruine verglacante legere', icon: '09d' },
  57: { text: 'Bruine verglacante dense', icon: '09d' },
  61: { text: 'Pluie legere', icon: '10d' },
  63: { text: 'Pluie moderee', icon: '10d' },
  65: { text: 'Pluie forte', icon: '10d' },
  66: { text: 'Pluie verglacante legere', icon: '13d' },
  67: { text: 'Pluie verglacante forte', icon: '13d' },
  71: { text: 'Neige legere', icon: '13d' },
  73: { text: 'Neige moderee', icon: '13d' },
  75: { text: 'Neige forte', icon: '13d' },
  77: { text: 'Grains de neige', icon: '13d' },
  80: { text: 'Averses legeres', icon: '09d' },
  81: { text: 'Averses moderees', icon: '09d' },
  82: { text: 'Averses violentes', icon: '09d' },
  85: { text: 'Averses de neige legeres', icon: '13d' },
  86: { text: 'Averses de neige fortes', icon: '13d' },
  95: { text: 'Orage', icon: '11d' },
  96: { text: 'Orage avec grele legere', icon: '11d' },
  99: { text: 'Orage avec grele forte', icon: '11d' },
};

function wmoToDescription(code: number): { text: string; icon: string } {
  return WMO_CODES[code] || { text: `Code ${code}`, icon: '03d' };
}

@Injectable()
export class OpenMeteoProvider implements WeatherProvider {
  private readonly logger = new Logger('Weather:OpenMeteo');
  readonly name = 'open-meteo' as const;

  async fetch(config: WeatherProviderConfig): Promise<RawWeatherData> {
    const { latitude, longitude } = config;

    const params = new URLSearchParams({
      latitude: latitude.toString(),
      longitude: longitude.toString(),
      current: [
        'temperature_2m',
        'relative_humidity_2m',
        'apparent_temperature',
        'precipitation',
        'rain',
        'weather_code',
        'wind_speed_10m',
        'wind_gusts_10m',
      ].join(','),
      hourly: [
        'temperature_2m',
        'apparent_temperature',
        'precipitation',
        'weather_code',
      ].join(','),
      timezone: 'auto',
      forecast_days: '1',
    });

    const url = `https://api.open-meteo.com/v1/forecast?${params}`;
    this.logger.debug(`Fetching: ${url}`);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    try {
      const response = await fetch(url, { signal: controller.signal });
      clearTimeout(timeout);

      if (!response.ok) {
        throw new Error(`Open-Meteo HTTP ${response.status}: ${response.statusText}`);
      }

      const json = await response.json();
      return this.parseResponse(json);
    } catch (err: any) {
      clearTimeout(timeout);
      if (err.name === 'AbortError') {
        throw new Error('Open-Meteo request timed out (5s)');
      }
      throw err;
    }
  }

  private parseResponse(json: any): RawWeatherData {
    const current = json.current;
    const hourly = json.hourly;
    const wmo = wmoToDescription(current.weather_code);

    // Build hourly forecast (next 24 entries = 24 hours)
    const hourlyForecast: RawHourlyEntry[] = [];
    const now = new Date();

    if (hourly?.time) {
      for (let i = 0; i < hourly.time.length && hourlyForecast.length < 24; i++) {
        const entryTime = new Date(hourly.time[i]);
        if (entryTime <= now) continue; // skip past hours

        const code = hourly.weather_code?.[i] ?? 0;
        const wmoEntry = wmoToDescription(code);

        hourlyForecast.push({
          time: entryTime.toISOString(),
          temp: hourly.temperature_2m?.[i] ?? 0,
          feelsLike: hourly.apparent_temperature?.[i] ?? hourly.temperature_2m?.[i] ?? 0,
          conditionCode: code,
          conditionText: wmoEntry.text,
          rainMm: hourly.precipitation?.[i] ?? 0,
        });
      }
    }

    return {
      temp: current.temperature_2m ?? 0,
      feelsLike: current.apparent_temperature ?? current.temperature_2m ?? 0,
      humidity: current.relative_humidity_2m ?? 0,
      windSpeed: (current.wind_speed_10m ?? 0) / 3.6, // km/h → m/s (will be re-converted)
      windGust: current.wind_gusts_10m ? current.wind_gusts_10m / 3.6 : null,
      conditionCode: current.weather_code ?? 0,
      conditionText: wmo.text,
      icon: wmo.icon,
      rainMm: current.rain ?? current.precipitation ?? 0,
      hourlyForecast,
    };
  }
}
