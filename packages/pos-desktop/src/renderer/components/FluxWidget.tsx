import React from 'react';
import { Users, CloudSun, Droplets, Thermometer, Wind, AlertTriangle } from 'lucide-react';
import type { OccupancyData, WeatherData } from '../stores/posStore';

interface FluxWidgetProps {
  occupancy: OccupancyData | null;
  weather: WeatherData | null;
}

function getOccupancyColor(count: number): string {
  if (count >= 15) return 'bg-red-100 text-red-600';
  if (count >= 8) return 'bg-amber-100 text-amber-600';
  if (count >= 3) return 'bg-emerald-100 text-emerald-600';
  return 'bg-pos-subtle text-pos-muted';
}

function getOccupancyLabel(count: number): string {
  if (count >= 15) return 'Dense';
  if (count >= 8) return 'Actif';
  if (count >= 3) return 'Normal';
  return 'Calme';
}

/** Business category → colored dot classes */
function getCategoryDotColor(category: string): string {
  switch (category) {
    case 'hot':        return 'bg-orange-400';
    case 'cold':       return 'bg-blue-400';
    case 'rain':       return 'bg-blue-600';
    case 'heavy_rain': return 'bg-blue-800';
    case 'wind':       return 'bg-gray-500';
    case 'clear':      return 'bg-emerald-400';
    case 'cloudy':     return 'bg-gray-400';
    default:           return 'bg-gray-300';
  }
}

/** Build a rich tooltip string */
function buildWeatherTooltip(w: WeatherData): string {
  const lines: string[] = [];
  lines.push(`${w.city}: ${w.description}`);
  lines.push(`Temp: ${Math.round(w.temp)}°C (ressenti ${Math.round(w.feelsLike)}°C)`);

  if (w.isRaining) {
    lines.push(`Pluie: ${w.rainIntensity} mm/h`);
  }

  if (w.trafficImpact) {
    const pct = w.trafficImpact.estimatedImpactPercent;
    const sign = pct > 0 ? '+' : '';
    lines.push(`Trafic: ${w.trafficImpact.message} (${sign}${pct}%)`);
  }

  if (w.recommendations && w.recommendations.length > 0) {
    lines.push('---');
    w.recommendations.forEach((r) => lines.push(`• ${r.message}`));
  }

  return lines.join('\n');
}

export function FluxWidget({ occupancy, weather }: FluxWidgetProps) {
  if (!occupancy && !weather) return null;

  return (
    <div className="flex items-center gap-2">
      {/* Occupancy pill */}
      {occupancy && (
        <div
          className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold ${getOccupancyColor(occupancy.liveCount)}`}
          title={`Flux magasin: ${occupancy.liveCount} personnes`}
        >
          <Users size={12} />
          <span>{occupancy.liveCount}</span>
          <span className="opacity-70 hidden sm:inline">{getOccupancyLabel(occupancy.liveCount)}</span>
        </div>
      )}

      {/* Weather pill — enriched */}
      {weather && (
        <div
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-pos-subtle text-pos-muted text-xs font-medium"
          title={buildWeatherTooltip(weather)}
        >
          {/* Category dot */}
          <span className={`w-2 h-2 rounded-full ${getCategoryDotColor(weather.businessCategory)}`} />

          {/* Weather icon */}
          {weather.icon ? (
            <img
              src={`https://openweathermap.org/img/wn/${weather.icon}.png`}
              alt={weather.description}
              className="w-4 h-4"
            />
          ) : (
            <CloudSun size={12} />
          )}

          {/* Temp */}
          <span>{Math.round(weather.temp)}&#176;</span>

          {/* Feels like (show if difference > 3°) */}
          {Math.abs(weather.temp - weather.feelsLike) > 3 && (
            <span className="opacity-50 hidden sm:inline">
              <Thermometer size={10} className="inline" />
              {Math.round(weather.feelsLike)}&#176;
            </span>
          )}

          {/* Rain badge */}
          {weather.isRaining && (
            <span className="text-blue-500 hidden sm:inline">
              <Droplets size={10} className="inline" />
            </span>
          )}
        </div>
      )}
    </div>
  );
}
