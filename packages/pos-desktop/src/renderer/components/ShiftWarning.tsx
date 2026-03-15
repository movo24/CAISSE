import React from 'react';
import { AlertTriangle, Clock, ArrowRight } from 'lucide-react';
import { usePlanning } from '../hooks/usePlanning';

/* ═══════════════════════════════════════════════════════════════
   ShiftWarning — Bandeau amber si hors créneau planifié
   Non bloquant : information seulement, le caissier peut continuer
   ═══════════════════════════════════════════════════════════════ */

export function ShiftWarning() {
  const planning = usePlanning();

  // Pas de planning chargé ou dans le créneau → rien à afficher
  if (!planning.hasPlanning) return null;
  if (!planning.warningMessage) return null;

  const isOvertime = planning.isAfterShift;
  const isEarly = planning.isBeforeShift;
  const isRestDay = !planning.hasShiftToday;

  return (
    <div
      className={`px-4 py-1.5 flex items-center justify-between text-xs font-medium transition-all duration-300 ${
        isRestDay
          ? 'bg-blue-50 text-blue-700 border-b border-blue-100'
          : isOvertime
          ? 'bg-orange-50 text-orange-700 border-b border-orange-100'
          : 'bg-amber-50 text-amber-700 border-b border-amber-100'
      }`}
    >
      <div className="flex items-center gap-2">
        <AlertTriangle size={13} className={
          isRestDay ? 'text-blue-500' : isOvertime ? 'text-orange-500' : 'text-amber-500'
        } />
        <span>{planning.warningMessage}</span>
      </div>

      {planning.hasShiftToday && (
        <div className="flex items-center gap-3">
          {/* Shift time */}
          <div className="flex items-center gap-1 opacity-70">
            <Clock size={11} />
            <span>{planning.formattedShiftTime}</span>
          </div>

          {/* Remaining time (only if currently in shift or before) */}
          {!isOvertime && planning.remainingMinutes > 0 && (
            <div className="flex items-center gap-1 bg-white/60 rounded-lg px-2 py-0.5">
              <ArrowRight size={10} />
              <span className="font-bold">{planning.formattedRemaining} restant</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
