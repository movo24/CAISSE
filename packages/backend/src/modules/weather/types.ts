// ── weather/types.ts ──────────────────────────────────────────────
// Shared interfaces for the Weather Intelligence module
// ─────────────────────────────────────────────────────────────────

/** Business-normalized weather categories */
export type BusinessWeatherCategory =
  | 'hot'
  | 'cold'
  | 'rain'
  | 'heavy_rain'
  | 'wind'
  | 'clear'
  | 'cloudy';

/** Current weather conditions (enriched) */
export interface WeatherCondition {
  temp: number;                          // °C
  feelsLike: number;                     // °C ressenti
  humidity: number;                      // %
  windSpeed: number;                     // km/h
  windGust: number | null;               // km/h
  isRaining: boolean;
  rainIntensity: number;                 // mm/h (0 = pas de pluie)
  condition: string;                     // description texte FR
  conditionCode: number;                 // WMO code ou OpenWeather code
  icon: string;                          // icone (retrocompat OpenWeather)
  businessCategory: BusinessWeatherCategory;
}

/** Hourly forecast entry */
export interface WeatherForecast {
  time: string;                          // ISO timestamp
  temp: number;
  feelsLike: number;
  isRaining: boolean;
  rainIntensity: number;
  condition: string;
  businessCategory: BusinessWeatherCategory;
}

/** Full weather response returned by the API */
export interface WeatherResponse {
  current: WeatherCondition;
  forecast3h: WeatherForecast[];         // prochaines 3h (pas de 1h)
  forecastDay: WeatherForecast[];        // prevision journee (pas de 3h)
  recommendations: WeatherRecommendation[];
  trafficImpact: TrafficImpact;
  provider: 'open-meteo' | 'openweather';
  cachedAt: string;                      // ISO timestamp
  storeCity: string;
}

/** Product recommendation based on weather */
export interface WeatherRecommendation {
  type: 'push_product' | 'alert' | 'info';
  message: string;
  productKeywords: string[];             // mots-cles pour recherche produit
  priority: 'high' | 'medium' | 'low';
}

/** Estimated traffic impact based on weather */
export interface TrafficImpact {
  level: 'positive' | 'neutral' | 'negative';
  message: string;
  estimatedImpactPercent: number;        // ex: -15 pour baisse 15%
}

/** Horodated weather snapshot for event correlation */
export interface WeatherSnapshot {
  storeId: string;
  timestamp: string;
  current: WeatherCondition;
  businessCategory: BusinessWeatherCategory;
  trafficImpact: TrafficImpact;
}

/** Legacy format for backward compat with existing FluxWidget */
export interface LegacyWeatherData {
  icon: string;
  temp: number;
  description: string;
  cachedAt: Date;
}
