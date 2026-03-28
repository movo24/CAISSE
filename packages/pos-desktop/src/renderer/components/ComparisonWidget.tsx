import React, { useState, useEffect, useRef } from 'react';
import { Trophy, AlertTriangle, TrendingUp, Sparkles, X } from 'lucide-react';
import { useComparisonStore } from '../stores/comparisonStore';
import { API_URL } from '../utils/apiConfig';

/* ═══════════════════════════════════════════════════════════════
   ComparisonWidget — Badge compact + popover détaillé
   Affiche le rang du magasin dans le réseau et les métriques clés.
   Pattern identique à StaffingWidget.
   ═══════════════════════════════════════════════════════════════ */

function formatEuros(minorUnits: number): string {
  return (minorUnits / 100).toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ' \u20ac';
}

const rankConfig: Record<number, { color: string; bg: string; ring: string; emoji: string }> = {
  1: { color: 'text-amber-600', bg: 'bg-amber-50', ring: 'ring-amber-200', emoji: '\ud83e\udd47' },
  2: { color: 'text-slate-500', bg: 'bg-slate-50', ring: 'ring-slate-200', emoji: '\ud83e\udd48' },
  3: { color: 'text-orange-600', bg: 'bg-orange-50', ring: 'ring-orange-200', emoji: '\ud83e\udd49' },
};

const defaultRankCfg = { color: 'text-slate-500', bg: 'bg-slate-50', ring: 'ring-slate-200', emoji: '' };

export function ComparisonWidget() {
  const comparison = useComparisonStore();
  const [open, setOpen] = useState(false);
  const [aiInsight, setAiInsight] = useState<string | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Close on click outside + Escape
  useEffect(() => {
    if (!open) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [open]);

  // Auto-refresh display every 60s
  const [, setTick] = useState(0);
  useEffect(() => {
    const iv = setInterval(() => setTick((t) => t + 1), 60_000);
    return () => clearInterval(iv);
  }, []);

  if (!comparison.isPolling || comparison.totalStores < 2) return null;

  const cfg = rankConfig[comparison.myRank] ?? defaultRankCfg;
  const hasAlerts = comparison.inactiveAlerts.length > 0;

  const fetchInsight = async () => {
    setAiLoading(true);
    try {
      const token = localStorage.getItem('accessToken');
      const res = await fetch(`${API_URL}/api/live-performance/insight`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setAiInsight(data.insight);
    } catch {
      setAiInsight('Impossible de charger les suggestions.');
    } finally {
      setAiLoading(false);
    }
  };

  return (
    <div ref={containerRef} className="relative">
      {/* Badge compact */}
      <button
        onClick={() => setOpen(!open)}
        className={`flex items-center gap-1.5 text-[10px] font-semibold px-2 py-1 rounded-full transition-colors ring-1 ${cfg.bg} ${cfg.color} ${cfg.ring} hover:brightness-95`}
        title="Performance Réseau — cliquer pour détails"
      >
        <Trophy size={10} />
        <span>{cfg.emoji} {comparison.myRank}e/{comparison.totalStores}</span>
        {hasAlerts && (
          <AlertTriangle size={9} className="text-orange-500 animate-pulse" />
        )}
      </button>

      {/* Popover */}
      {open && (
        <div className="absolute top-full left-0 mt-2 w-72 bg-white rounded-xl shadow-xl border border-gray-100 z-50 overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-3 py-2 bg-gradient-to-r from-pink-500 to-rose-500">
            <div className="flex items-center gap-1.5">
              <Trophy size={12} className="text-white" />
              <span className="text-white text-xs font-bold">Performance Réseau</span>
            </div>
            <button onClick={() => setOpen(false)} className="text-white/70 hover:text-white">
              <X size={12} />
            </button>
          </div>

          <div className="p-3 space-y-3">
            {/* Rank */}
            <div className="text-center">
              <div className="text-2xl font-black text-gray-800">
                {cfg.emoji} {comparison.myRank}<span className="text-sm font-medium text-gray-400">/{comparison.totalStores}</span>
              </div>
              <p className="text-[10px] text-gray-400">{comparison.myStoreName}</p>
            </div>

            {/* Revenue comparison */}
            <div className="space-y-1">
              <div className="flex justify-between text-[10px]">
                <span className="text-gray-500">Mon CA</span>
                <span className="font-semibold text-gray-700">{formatEuros(comparison.myRevenue)}</span>
              </div>
              <div className="w-full bg-gray-100 rounded-full h-1.5">
                <div
                  className="bg-pink-500 h-1.5 rounded-full transition-all"
                  style={{
                    width: `${comparison.leaderRevenue > 0 ? Math.min(100, (comparison.myRevenue / comparison.leaderRevenue) * 100) : 0}%`,
                  }}
                />
              </div>
              <div className="flex justify-between text-[10px]">
                <span className="text-gray-500">Leader: {comparison.leaderStoreName}</span>
                <span className="font-semibold text-gray-700">{formatEuros(comparison.leaderRevenue)}</span>
              </div>
              {comparison.deltaPercent > 0 && (
                <div className="flex items-center gap-1 text-[10px] text-amber-600">
                  <TrendingUp size={9} />
                  <span>{comparison.deltaPercent}% d'écart</span>
                </div>
              )}
            </div>

            {/* Inactive alerts */}
            {hasAlerts && (
              <div className="space-y-1">
                <p className="text-[10px] font-semibold text-orange-600 flex items-center gap-1">
                  <AlertTriangle size={9} />
                  Alertes inactivité
                </p>
                {comparison.inactiveAlerts.map((a, i) => (
                  <div key={i} className="text-[10px] text-gray-500 pl-3">
                    {a.storeName} — {a.minutesSinceLastSale} min sans vente
                  </div>
                ))}
              </div>
            )}

            {/* AI Insight */}
            <div className="border-t border-gray-100 pt-2">
              {aiInsight ? (
                <div className="text-[10px] text-gray-600 whitespace-pre-wrap leading-relaxed">
                  {aiInsight}
                </div>
              ) : (
                <button
                  onClick={fetchInsight}
                  disabled={aiLoading}
                  className="w-full flex items-center justify-center gap-1.5 text-[10px] font-semibold px-2 py-1.5 rounded-lg bg-pink-50 text-pink-600 hover:bg-pink-100 transition-colors disabled:opacity-50"
                >
                  <Sparkles size={10} />
                  {aiLoading ? 'Analyse en cours...' : 'Voir suggestions IA'}
                </button>
              )}
            </div>

            {/* Last updated */}
            {comparison.lastFetchedAt && (
              <p className="text-[9px] text-gray-300 text-center">
                Mis à jour à {new Date(comparison.lastFetchedAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
