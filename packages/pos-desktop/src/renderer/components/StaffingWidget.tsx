import React, { useState, useEffect } from 'react';
import { Users, TrendingUp, AlertTriangle, ChevronRight, Clock, Target, Zap } from 'lucide-react';
import { useStaffingStore, StaffingLevel } from '../services/staffingEngine';

/* ═══════════════════════════════════════════════════════════════
   StaffingWidget — Indicateur IA staffing dans le header POS
   - Badge compact avec couleur : vert / orange / rouge
   - Click → popover detail avec CA, objectif, recommandation
   ═══════════════════════════════════════════════════════════════ */

const levelConfig: Record<StaffingLevel, { color: string; bg: string; ring: string; label: string; icon: 'ok' | 'warn' | 'alert' }> = {
  optimal:       { color: 'text-emerald-600', bg: 'bg-emerald-50',  ring: 'ring-emerald-200', label: 'Optimal',       icon: 'ok' },
  tension:       { color: 'text-amber-600',   bg: 'bg-amber-50',    ring: 'ring-amber-200',   label: 'Tension',       icon: 'warn' },
  surcharge:     { color: 'text-red-600',      bg: 'bg-red-50',      ring: 'ring-red-200',     label: 'Surcharge',     icon: 'alert' },
  sous_effectif: { color: 'text-orange-600',   bg: 'bg-orange-50',   ring: 'ring-orange-200',  label: 'Sous-effectif', icon: 'warn' },
  unknown:       { color: 'text-slate-500',    bg: 'bg-slate-50',    ring: 'ring-slate-200',   label: 'Analyse...',    icon: 'ok' },
};

function formatEuros(minorUnits: number): string {
  return (minorUnits / 100).toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ' \u20ac';
}

export function StaffingWidget() {
  const staffing = useStaffingStore();
  const [open, setOpen] = useState(false);
  const [, setTick] = useState(0);

  // Force re-render every 60s for live numbers
  useEffect(() => {
    const iv = setInterval(() => setTick((t) => t + 1), 60_000);
    return () => clearInterval(iv);
  }, []);

  if (!staffing.isRunning) return null;

  const cfg = levelConfig[staffing.level];
  const capacityPct = Math.round(staffing.getCapacityRate() * 100);
  const revenuePct = Math.round(staffing.getRevenueRate() * 100);
  const target = staffing.getCurrentTarget();
  const txPerHour = staffing.getTxPerHourPerCashier();

  return (
    <div className="relative">
      {/* ── Badge compact ── */}
      <button
        onClick={() => setOpen(!open)}
        className={`flex items-center gap-1.5 text-[10px] font-semibold px-2 py-1 rounded-full transition-colors ring-1 min-w-0 ${cfg.bg} ${cfg.color} ${cfg.ring} hover:brightness-95`}
        title="Staffing IA — cliquer pour details"
      >
        {cfg.icon === 'alert' ? (
          <AlertTriangle size={10} className="animate-pulse flex-shrink-0" />
        ) : cfg.icon === 'warn' ? (
          <AlertTriangle size={10} className="flex-shrink-0" />
        ) : (
          <Users size={10} className="flex-shrink-0" />
        )}
        {/* Seul libellé à largeur variable de la barre : tronqué en ellipsis si
            l'espace manque (jamais de chevauchement sur les actions voisines). */}
        <span className="truncate">{cfg.label}</span>
        {staffing.activeCashiers.length > 0 && (
          <span className="opacity-60 flex-shrink-0">{staffing.activeCashiers.length}</span>
        )}
      </button>

      {/* ── Popover detail ── */}
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute top-full left-0 mt-2 w-72 bg-white rounded-2xl shadow-elevated border border-pos-border/30 z-50 animate-scale-in overflow-hidden">
            {/* Header */}
            <div className={`px-4 py-3 border-b border-pos-border/20 ${cfg.bg}`}>
              <div className="flex items-center justify-between">
                <p className={`text-xs font-bold ${cfg.color}`}>
                  {cfg.icon === 'alert' && <AlertTriangle size={12} className="inline mr-1" />}
                  Statut Staffing : {cfg.label}
                </p>
                <span className="text-[10px] text-pos-muted">
                  {staffing.activeCashiers.length} caisse{staffing.activeCashiers.length > 1 ? 's' : ''}
                </span>
              </div>
            </div>

            {/* KPIs */}
            <div className="px-4 py-3 space-y-2.5">
              {/* CA heure en cours */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <TrendingUp size={12} className="text-pos-muted" />
                  <span className="text-[11px] text-pos-muted">CA heure en cours</span>
                </div>
                <span className="text-xs font-bold text-pos-text">
                  {formatEuros(staffing.currentHourRevenue)}
                </span>
              </div>

              {/* Objectif heure */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <Target size={12} className="text-pos-muted" />
                  <span className="text-[11px] text-pos-muted">Objectif heure</span>
                </div>
                <span className="text-xs font-bold text-pos-text">
                  {target.revenueTarget > 0 ? formatEuros(target.revenueTarget) : '-'}
                </span>
              </div>

              {/* Progress bar CA */}
              {target.revenueTarget > 0 && (
                <div className="w-full h-1.5 bg-slate-100 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-500 ${
                      revenuePct >= 100 ? 'bg-emerald-500' : revenuePct >= 60 ? 'bg-amber-500' : 'bg-red-500'
                    }`}
                    style={{ width: `${Math.min(100, revenuePct)}%` }}
                  />
                </div>
              )}

              {/* Transactions */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <Zap size={12} className="text-pos-muted" />
                  <span className="text-[11px] text-pos-muted">Transactions heure</span>
                </div>
                <span className="text-xs font-bold text-pos-text">
                  {staffing.currentHourTx}
                </span>
              </div>

              {/* Capacite */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <Clock size={12} className="text-pos-muted" />
                  <span className="text-[11px] text-pos-muted">Capacite utilisee</span>
                </div>
                <span className={`text-xs font-bold ${
                  capacityPct > 85 ? 'text-red-600' : capacityPct > 70 ? 'text-amber-600' : 'text-emerald-600'
                }`}>
                  {capacityPct}%
                </span>
              </div>

              {/* TX/h par caissier */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <Users size={12} className="text-pos-muted" />
                  <span className="text-[11px] text-pos-muted">TX/h par caissier</span>
                </div>
                <span className="text-xs font-bold text-pos-text">
                  {txPerHour}
                </span>
              </div>
            </div>

            {/* Employes actifs */}
            {staffing.activeCashiers.length > 0 && (
              <div className="px-4 py-2 border-t border-pos-border/20">
                <p className="text-[10px] font-bold text-pos-muted uppercase tracking-wider mb-1.5">Employes actifs</p>
                {staffing.activeCashiers.map((c) => (
                  <div key={c.cashierId} className="flex items-center justify-between py-0.5">
                    <span className="text-[11px] text-pos-text">{c.cashierName}</span>
                    <span className="text-[10px] text-pos-muted">{c.txCount} tx</span>
                  </div>
                ))}
              </div>
            )}

            {/* Recommandation IA */}
            {staffing.lastRecommendation && staffing.lastRecommendation.type !== 'none' && (
              <div className={`px-4 py-2.5 border-t ${
                staffing.lastRecommendation.urgency === 'high'
                  ? 'bg-red-50 border-red-100'
                  : staffing.lastRecommendation.urgency === 'medium'
                  ? 'bg-amber-50 border-amber-100'
                  : 'bg-blue-50 border-blue-100'
              }`}>
                <div className="flex items-start gap-2">
                  <ChevronRight size={12} className={
                    staffing.lastRecommendation.urgency === 'high' ? 'text-red-500 mt-0.5' : 'text-amber-500 mt-0.5'
                  } />
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-wider text-pos-muted mb-0.5">
                      Recommandation IA
                    </p>
                    <p className="text-[11px] font-medium text-pos-text leading-snug">
                      {staffing.lastRecommendation.reason}
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* Footer: last analysis */}
            <div className="px-4 py-2 border-t border-pos-border/20 bg-pos-subtle/30">
              <p className="text-[9px] text-pos-muted text-center">
                Analyse #{staffing.analysisCount} — maj toutes les 5 min
              </p>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
