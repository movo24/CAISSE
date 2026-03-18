// ── weather/weather-rules.ts ─────────────────────────────────────
// Business rules: product recommendations + traffic impact
// Pure functions — no dependencies, fully testable
// ─────────────────────────────────────────────────────────────────

import {
  BusinessWeatherCategory,
  WeatherRecommendation,
  TrafficImpact,
} from './types';

export class WeatherRules {
  /**
   * Generate product recommendations based on weather conditions
   */
  static getRecommendations(
    category: BusinessWeatherCategory,
    temp: number,
  ): WeatherRecommendation[] {
    const rules: WeatherRecommendation[] = [];

    // ── Rain / Heavy rain ──
    if (category === 'heavy_rain') {
      rules.push({
        type: 'push_product',
        message: 'Fortes pluies : mettre en avant parapluies, impermeables, produits de confort',
        productKeywords: ['parapluie', 'impermeable', 'pluie', 'botte', 'poncho'],
        priority: 'high',
      });
      rules.push({
        type: 'push_product',
        message: 'Temps froid et humide : boissons chaudes recommandees',
        productKeywords: ['the', 'cafe', 'chocolat', 'soupe', 'tisane'],
        priority: 'medium',
      });
      rules.push({
        type: 'alert',
        message: 'Fortes pluies prevues — anticiper une baisse de frequentation importante',
        productKeywords: [],
        priority: 'high',
      });
    } else if (category === 'rain') {
      rules.push({
        type: 'push_product',
        message: 'Pluie : suggerer parapluies et produits de confort',
        productKeywords: ['parapluie', 'impermeable', 'pluie', 'the', 'cafe'],
        priority: 'medium',
      });
    }

    // ── Cold ──
    if (category === 'cold') {
      rules.push({
        type: 'push_product',
        message: 'Froid : suggerer accessoires chauds et boissons chaudes',
        productKeywords: [
          'echarpe', 'gants', 'bonnet', 'chaussettes',
          'veste', 'manteau', 'pull', 'polaire',
          'cafe', 'the', 'chocolat',
        ],
        priority: temp <= 0 ? 'high' : 'medium',
      });
      if (temp <= -5) {
        rules.push({
          type: 'alert',
          message: 'Grand froid : conditions extremes, frequentation tres reduite attendue',
          productKeywords: [],
          priority: 'high',
        });
      }
    }

    // ── Hot ──
    if (category === 'hot') {
      rules.push({
        type: 'push_product',
        message: 'Chaleur : mettre en avant boissons froides et produits ete',
        productKeywords: [
          'eau', 'boisson', 'jus', 'glace', 'sorbet',
          'lunettes', 'chapeau', 'casquette', 'creme solaire',
          'ventilateur', 'eventail',
        ],
        priority: temp >= 35 ? 'high' : 'medium',
      });
      if (temp >= 35) {
        rules.push({
          type: 'alert',
          message: 'Canicule : attention a la frequentation, privilegier la climatisation',
          productKeywords: [],
          priority: 'high',
        });
      }
    }

    // ── Wind ──
    if (category === 'wind') {
      rules.push({
        type: 'info',
        message: 'Vent fort : conditions desagreables pour les pietons',
        productKeywords: ['coupe-vent', 'veste', 'echarpe'],
        priority: 'low',
      });
    }

    // ── Clear (nice weather) ──
    if (category === 'clear' && temp >= 15 && temp <= 28) {
      rules.push({
        type: 'info',
        message: 'Beau temps : conditions ideales, bonne frequentation attendue',
        productKeywords: [],
        priority: 'low',
      });
    }

    return rules;
  }

  /**
   * Estimate traffic impact based on weather conditions
   */
  static getTrafficImpact(
    category: BusinessWeatherCategory,
    temp: number,
  ): TrafficImpact {
    // Heavy rain — major negative impact
    if (category === 'heavy_rain') {
      return {
        level: 'negative',
        message: 'Fortes pluies : baisse de frequentation attendue (-25%)',
        estimatedImpactPercent: -25,
      };
    }

    // Light rain — minor negative impact
    if (category === 'rain') {
      return {
        level: 'negative',
        message: 'Pluie : legere baisse de trafic possible (-10%)',
        estimatedImpactPercent: -10,
      };
    }

    // Extreme heat
    if (category === 'hot' && temp >= 35) {
      return {
        level: 'negative',
        message: 'Canicule : frequentation potentiellement reduite (-15%)',
        estimatedImpactPercent: -15,
      };
    }

    // Extreme cold
    if (category === 'cold' && temp <= -5) {
      return {
        level: 'negative',
        message: 'Grand froid : frequentation reduite (-20%)',
        estimatedImpactPercent: -20,
      };
    }

    // Moderate cold
    if (category === 'cold') {
      return {
        level: 'negative',
        message: 'Temps froid : legere baisse de trafic (-5%)',
        estimatedImpactPercent: -5,
      };
    }

    // Strong wind
    if (category === 'wind') {
      return {
        level: 'negative',
        message: 'Vent fort : impact negatif modere (-10%)',
        estimatedImpactPercent: -10,
      };
    }

    // Perfect weather
    if (category === 'clear' && temp >= 15 && temp <= 25) {
      return {
        level: 'positive',
        message: 'Temps ideal : bonne frequentation attendue (+10%)',
        estimatedImpactPercent: 10,
      };
    }

    // Mild warm
    if (category === 'clear' || (category === 'hot' && temp < 35)) {
      return {
        level: 'positive',
        message: 'Beau temps : conditions favorables (+5%)',
        estimatedImpactPercent: 5,
      };
    }

    // Default neutral
    return {
      level: 'neutral',
      message: 'Conditions meteo normales',
      estimatedImpactPercent: 0,
    };
  }
}
