/**
 * POS — Weather → sales impact (pure, unit-testable).
 * Extracted from ExternalContextService (behavior-preserving): maps temperature
 * and condition to a foot-traffic impact score (-1…+1) and a French reason.
 */

export interface WeatherImpact {
  impactScore: number;
  impactReason: string;
}

/**
 * Impact of weather on foot traffic. `condition` is the lowercased OpenWeather
 * `main` (e.g. 'rain', 'snow', 'clear'). Order matches the legacy if/else chain.
 */
export function weatherImpact(temp: number, condition: string): WeatherImpact {
  const c = condition || '';
  if (c.includes('rain') || c.includes('drizzle')) {
    return { impactScore: -0.3, impactReason: 'Pluie — trafic piéton réduit, clients dépannage' };
  }
  if (c.includes('snow') || c.includes('storm')) {
    return { impactScore: -0.6, impactReason: 'Intempéries — forte baisse trafic attendue' };
  }
  if (temp > 30) {
    return { impactScore: 0.4, impactReason: 'Chaleur — forte demande boissons fraîches' };
  }
  if (temp < 5) {
    return { impactScore: -0.2, impactReason: 'Froid — clients rapides, paniers plus petits' };
  }
  if (c.includes('clear') && temp > 15 && temp < 28) {
    return { impactScore: 0.3, impactReason: 'Beau temps — bon trafic piéton attendu' };
  }
  return { impactScore: 0, impactReason: 'Conditions normales' };
}
