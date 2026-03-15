import React, { useState } from 'react';
import { Clock, Coffee, LogOut, Play, Pause } from 'lucide-react';
import { usePointage } from '../hooks/usePointage';
import { usePOSStore } from '../stores/posStore';

/**
 * Compact header badge showing current shift duration.
 * On click: mini-popover with clock-in time, break controls, clock-out.
 */
export function ShiftIndicator() {
  const pointage = usePointage();
  const employee = usePOSStore((s) => s.employee);
  const [open, setOpen] = useState(false);

  if (!pointage.isClocked || !employee) return null;

  return (
    <div className="relative">
      {/* Badge */}
      <button
        onClick={() => setOpen(!open)}
        className={`flex items-center gap-1.5 text-[10px] font-semibold px-2 py-1 rounded-full transition-colors ${
          pointage.isOnBreak
            ? 'bg-amber-50 text-amber-600 border border-amber-200'
            : 'bg-pos-subtle text-pos-muted hover:bg-pos-border/30'
        }`}
        title="Pointage — cliquer pour details"
      >
        {pointage.isOnBreak ? <Coffee size={10} className="animate-pulse" /> : <Clock size={10} />}
        <span>{pointage.formattedDuration}</span>
        {pointage.isOnBreak && <span className="text-[8px] font-bold text-amber-500">PAUSE</span>}
      </button>

      {/* Popover */}
      {open && (
        <>
          {/* Backdrop */}
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />

          {/* Content */}
          <div className="absolute top-full right-0 mt-2 w-56 bg-white rounded-2xl shadow-elevated border border-pos-border/30 z-50 animate-scale-in overflow-hidden">
            <div className="px-4 py-3 bg-pos-subtle/40 border-b border-pos-border/20">
              <p className="text-xs font-bold text-pos-text">Pointage du jour</p>
              <p className="text-[10px] text-pos-muted mt-0.5">
                {employee.firstName} {employee.lastName}
              </p>
            </div>

            <div className="px-4 py-3 space-y-2.5">
              {/* Clock-in time */}
              <div className="flex items-center justify-between">
                <span className="text-[11px] text-pos-muted">Arrivee</span>
                <span className="text-xs font-bold text-pos-text">{pointage.clockInTime}</span>
              </div>

              {/* Duration */}
              <div className="flex items-center justify-between">
                <span className="text-[11px] text-pos-muted">Temps de travail</span>
                <span className="text-xs font-bold text-emerald-600">{pointage.formattedDuration}</span>
              </div>

              {/* Break */}
              {pointage.formattedBreak && (
                <div className="flex items-center justify-between">
                  <span className="text-[11px] text-pos-muted">Pause cumulee</span>
                  <span className="text-xs font-bold text-amber-600">{pointage.formattedBreak}</span>
                </div>
              )}
            </div>

            {/* Actions */}
            <div className="px-3 pb-3 space-y-1.5">
              {/* Break toggle */}
              {pointage.isOnBreak ? (
                <button
                  onClick={() => { pointage.endBreak(employee.id); setOpen(false); }}
                  className="w-full flex items-center justify-center gap-2 py-2 rounded-xl text-xs font-semibold bg-emerald-50 text-emerald-700 hover:bg-emerald-100 border border-emerald-200 transition-colors"
                >
                  <Play size={12} /> Fin de pause
                </button>
              ) : (
                <button
                  onClick={() => { pointage.startBreak(employee.id); setOpen(false); }}
                  className="w-full flex items-center justify-center gap-2 py-2 rounded-xl text-xs font-semibold bg-amber-50 text-amber-700 hover:bg-amber-100 border border-amber-200 transition-colors"
                >
                  <Pause size={12} /> Prendre une pause
                </button>
              )}

              {/* Clock out */}
              <button
                onClick={() => { pointage.clockOut(employee.id); setOpen(false); }}
                className="w-full flex items-center justify-center gap-2 py-2 rounded-xl text-xs font-semibold bg-red-50 text-red-600 hover:bg-red-100 border border-red-200 transition-colors"
              >
                <LogOut size={12} /> Pointer la sortie
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
