import React from 'react';
import { barHeightPct, chartMax, toFiniteNonNeg } from '../../utils/chartScale';

/**
 * Barres « Semaine en cours » (moyenne N-1 vs réalisé), extraites de
 * DashboardPage pour être testables : c'est ICI que la barre du vendredi
 * traversait le dashboard (domaine = moyenne N-1 seule, hauteur sans plafond).
 *
 * Garanties :
 *  - domaine = max(moyenne N-1 ∪ réalisé) assaini, strictement > 0 ;
 *  - hauteurs bornées [0, 100 %] (jamais au-delà de la zone de tracé) ;
 *  - le conteneur coupe tout débordement résiduel (`overflow-hidden`) ;
 *  - semaine entièrement à zéro → état vide propre, aucune barre artificielle ;
 *  - le % affiché n'est calculé QUE si la référence N-1 existe (> 0).
 */
export interface WeekBarsProps {
  days: readonly string[];
  /** Moyenne N-1 par jour (mêmes unités que `actual`). */
  weekAvg: ReadonlyArray<unknown>;
  /** Réalisé par jour. */
  weekActual: ReadonlyArray<unknown>;
  /** Index du jour courant (0 = lundi) ; les jours suivants sont « à venir ». */
  dayIndex: number;
}

export function WeekBars({ days, weekAvg, weekActual, dayIndex }: WeekBarsProps) {
  const maxVal = chartMax([weekAvg, weekActual]);
  const hasAnyData =
    weekAvg.some((v) => toFiniteNonNeg(v) > 0) || weekActual.some((v) => toFiniteNonNeg(v) > 0);

  if (!hasAnyData) {
    return (
      <div className="h-32 flex items-center justify-center" data-testid="week-empty">
        <p className="text-xs text-gray-400">Aucune vente enregistrée cette semaine.</p>
      </div>
    );
  }

  return (
    <div className="flex items-end gap-2 h-32 overflow-hidden" data-testid="week-bars">
      {days.map((day, i) => {
        const avg = toFiniteNonNeg(weekAvg[i]);
        const actual = toFiniteNonNeg(weekActual[i]);
        const isFuture = i > dayIndex;
        // % vs N-1 : uniquement quand une référence existe — jamais « 0 % »
        // mensonger (ni Infinity) quand la moyenne N-1 est vide.
        const pct = avg > 0 ? (actual / avg) * 100 : null;
        return (
          <div key={day} className="flex-1 flex flex-col items-center gap-1">
            {!isFuture && actual > 0 && pct !== null && (
              <span className={`text-[9px] font-bold ${pct >= 100 ? 'text-emerald-500' : 'text-amber-500'}`}>
                {Math.round(pct)}%
              </span>
            )}
            <div className="w-full flex gap-0.5 overflow-hidden" style={{ height: '90px', alignItems: 'flex-end' }}>
              <div
                className="flex-1 bg-gray-100 rounded-t"
                data-testid={`avg-bar-${i}`}
                style={{ height: `${barHeightPct(avg, maxVal)}%`, minHeight: avg > 0 ? '4px' : '0px' }}
              />
              {!isFuture && (
                <div
                  className={`flex-1 rounded-t ${pct === null || pct >= 100 ? 'bg-emerald-400' : 'bg-amber-400'}`}
                  data-testid={`actual-bar-${i}`}
                  style={{ height: `${barHeightPct(actual, maxVal)}%`, minHeight: actual > 0 ? '4px' : '0px' }}
                />
              )}
            </div>
            <span className={`text-[9px] font-medium ${i === dayIndex ? 'text-bo-text font-bold' : 'text-gray-400'}`}>{day}</span>
          </div>
        );
      })}
    </div>
  );
}
