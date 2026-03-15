// ── weather/weather-provider.interface.ts ────────────────────────
// Abstract provider interface — allows swapping Open-Meteo / OpenWeather
// ─────────────────────────────────────────────────────────────────

export interface WeatherProviderConfig {
  latitude: number;
  longitude: number;
  apiKey?: string;           // only for OpenWeather
  city?: string;             // fallback name for OpenWeather
}

/** Raw data returned by a weather provider before normalization */
export interface RawWeatherData {
  temp: number;              // °C
  feelsLike: number;         // °C
  humidity: number;          // %
  windSpeed: number;         // m/s (converted to km/h later)
  windGust: number | null;   // m/s
  conditionCode: number;     // WMO or OpenWeather code
  conditionText: string;     // human-readable description
  icon: string;              // icon identifier
  rainMm: number;            // precipitation mm/h
  hourlyForecast: RawHourlyEntry[];
}

export interface RawHourlyEntry {
  time: string;              // ISO timestamp
  temp: number;
  feelsLike: number;
  conditionCode: number;
  conditionText: string;
  rainMm: number;
}

/** Abstract weather provider contract */
export interface WeatherProvider {
  readonly name: 'open-meteo' | 'openweather';
  fetch(config: WeatherProviderConfig): Promise<RawWeatherData>;
}
