import React, { useState, useMemo, useEffect } from 'react';
import {
  Trophy, TrendingUp, TrendingDown, Clock, ShoppingCart,
  Zap, Target, ChevronDown, ChevronUp, BarChart3,
  User, Timer, Receipt, Euro, ArrowUpRight, ArrowDownRight,
  Ban, Package, Activity, Star, Medal, Award,
  CalendarDays, Filter, Download, RefreshCw,
} from 'lucide-react';
import { performanceApi } from '../services/api';

/* ═══════════════════════════════════════════════════════════════
   PERFORMANCE PAGE — Backoffice
   Ranking caissiers, profil individuel, comparaison, KPIs
   Données chargées via API.
   ═══════════════════════════════════════════════════════════════ */

// ── Types ──

interface CashierPerf {
  id: string;
  name: string;
  role: string;
  avatar: string; // initials
  // KPIs
  totalRevenue: number;          // centimes
  ticketCount: number;
  itemCount: number;
  avgBasket: number;             // centimes
  avgSpeed: number;              // secondes
  itemsPerMinute: number;
  ticketsPerHour: number;
  revenuePerHour: number;        // centimes
  voidCount: number;
  voidRate: number;              // %
  totalHoursWorked: number;      // heures décimales
  // Évolution vs période précédente
  revenueChange: number;         // %
  speedChange: number;           // %
  basketChange: number;          // %
  // Détail horaire
  hourlySplit: { hour: string; revenue: number; tickets: number }[];
  // Score composite (0–100)
  score: number;
}


// ── Helpers ──

const fmt = (minorUnits: number) =>
  (minorUnits / 100).toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ' \u20ac';

const fmtK = (minorUnits: number) => {
  const val = minorUnits / 100;
  if (val >= 10000) return (val / 1000).toFixed(1).replace('.', ',') + 'k \u20ac';
  if (val >= 1000) return (val / 1000).toFixed(2).replace('.', ',') + 'k \u20ac';
  return val.toFixed(0) + ' \u20ac';
};

const fmtSpeed = (seconds: number) =>
  seconds >= 60 ? `${Math.floor(seconds / 60)}min ${seconds % 60}s` : `${seconds}s`;

const scoreColor = (score: number) => {
  if (score >= 85) return 'text-emerald-600 bg-emerald-50';
  if (score >= 70) return 'text-blue-600 bg-blue-50';
  if (score >= 50) return 'text-amber-600 bg-amber-50';
  return 'text-red-600 bg-red-50';
};

const scoreBadge = (score: number) => {
  if (score >= 90) return { icon: Trophy, label: 'Excellent', color: 'text-amber-500' };
  if (score >= 80) return { icon: Star, label: 'Tres bien', color: 'text-emerald-500' };
  if (score >= 65) return { icon: Medal, label: 'Bien', color: 'text-blue-500' };
  if (score >= 50) return { icon: Award, label: 'Correct', color: 'text-amber-500' };
  return { icon: Target, label: 'A ameliorer', color: 'text-red-500' };
};

const changeIcon = (val: number) =>
  val > 0 ? <ArrowUpRight size={12} className="text-emerald-500" />
    : val < 0 ? <ArrowDownRight size={12} className="text-red-500" />
    : null;

const changeColor = (val: number, invert = false) => {
  const positive = invert ? val < 0 : val > 0;
  return positive ? 'text-emerald-600' : val === 0 ? 'text-gray-400' : 'text-red-600';
};

// ── Component ──

export function PerformancePage() {
  const [cashiers, setCashiers] = useState<CashierPerf[]>([]);
  const [selectedCashier, setSelectedCashier] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<'score' | 'revenue' | 'speed' | 'tickets' | 'voidRate'>('score');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [period, setPeriod] = useState('Cette semaine');

  useEffect(() => {
    performanceApi.ranking({ period }).then((res) => {
      setCashiers(res.data || []);
    }).catch(() => {});
  }, [period]);

  // Sort cashiers
  const sorted = useMemo(() => {
    const arr = [...cashiers];
    arr.sort((a, b) => {
      let valA: number, valB: number;
      switch (sortBy) {
        case 'score': valA = a.score; valB = b.score; break;
        case 'revenue': valA = a.totalRevenue; valB = b.totalRevenue; break;
        case 'speed': valA = a.avgSpeed; valB = b.avgSpeed; break;
        case 'tickets': valA = a.ticketCount; valB = b.ticketCount; break;
        case 'voidRate': valA = a.voidRate; valB = b.voidRate; break;
        default: valA = a.score; valB = b.score;
      }
      return sortDir === 'desc' ? valB - valA : valA - valB;
    });
    return arr;
  }, [sortBy, sortDir]);

  const selected = selectedCashier ? cashiers.find((c) => c.id === selectedCashier) : null;

  // Global KPIs (team)
  const teamStats = useMemo(() => {
    const total = cashiers.reduce((s, c) => s + c.totalRevenue, 0);
    const tickets = cashiers.reduce((s, c) => s + c.ticketCount, 0);
    const voids = cashiers.reduce((s, c) => s + c.voidCount, 0);
    const avgBasket = tickets > 0 ? Math.round(total / tickets) : 0;
    const avgSpeed = Math.round(cashiers.reduce((s, c) => s + c.avgSpeed, 0) / cashiers.length);
    const avgVoidRate = Math.round(cashiers.reduce((s, c) => s + c.voidRate, 0) / cashiers.length * 100) / 100;
    return { total, tickets, voids, avgBasket, avgSpeed, avgVoidRate };
  }, []);

  const handleSort = (col: typeof sortBy) => {
    if (sortBy === col) {
      setSortDir((d) => (d === 'desc' ? 'asc' : 'desc'));
    } else {
      setSortBy(col);
      setSortDir(col === 'speed' || col === 'voidRate' ? 'asc' : 'desc');
    }
  };

  const SortIcon = ({ col }: { col: typeof sortBy }) => {
    if (sortBy !== col) return <ChevronDown size={12} className="text-gray-300" />;
    return sortDir === 'desc' ? <ChevronDown size={12} className="text-bo-accent" /> : <ChevronUp size={12} className="text-bo-accent" />;
  };

  return (
    <div className="p-8 space-y-8 bg-gray-50/50 min-h-screen">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-bo-accent to-purple-600 flex items-center justify-center">
              <BarChart3 size={20} className="text-white" />
            </div>
            Performance Caissiers
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            Analyse detaillee des performances individuelles et equipe
          </p>
        </div>

        <div className="flex items-center gap-3">
          {/* Période */}
          <div className="flex items-center gap-2 bg-white border border-gray-200 rounded-xl px-3 py-2">
            <CalendarDays size={14} className="text-gray-400" />
            <select
              className="text-sm font-medium bg-transparent border-none outline-none text-gray-700"
              value={period}
              onChange={(e) => setPeriod(e.target.value)}
            >
              <option>Aujourd'hui</option>
              <option>Cette semaine</option>
              <option>Ce mois</option>
              <option>Mois dernier</option>
            </select>
          </div>

          {/* Export */}
          <button className="flex items-center gap-2 bg-white border border-gray-200 rounded-xl px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors">
            <Download size={14} />
            Exporter
          </button>

          {/* Refresh */}
          <button className="flex items-center gap-2 bg-bo-accent text-white rounded-xl px-4 py-2 text-sm font-semibold hover:bg-bo-accent/90 transition-colors">
            <RefreshCw size={14} />
            Actualiser
          </button>
        </div>
      </div>

      {/* ── Team KPI Cards ── */}
      <div className="grid grid-cols-6 gap-4">
        {[
          { label: 'CA Equipe', value: fmtK(teamStats.total), icon: Euro, color: 'text-emerald-600 bg-emerald-50' },
          { label: 'Tickets', value: teamStats.tickets.toString(), icon: Receipt, color: 'text-blue-600 bg-blue-50' },
          { label: 'Panier moyen', value: fmt(teamStats.avgBasket), icon: ShoppingCart, color: 'text-violet-600 bg-violet-50' },
          { label: 'Vitesse moy.', value: fmtSpeed(teamStats.avgSpeed), icon: Timer, color: 'text-amber-600 bg-amber-50' },
          { label: 'Annulations', value: teamStats.voids.toString(), icon: Ban, color: 'text-red-600 bg-red-50' },
          { label: 'Taux annul.', value: `${teamStats.avgVoidRate}%`, icon: Activity, color: 'text-orange-600 bg-orange-50' },
        ].map((kpi) => (
          <div key={kpi.label} className="bg-white rounded-2xl border border-gray-100 p-4">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">{kpi.label}</span>
              <div className={`w-8 h-8 rounded-xl flex items-center justify-center ${kpi.color}`}>
                <kpi.icon size={16} />
              </div>
            </div>
            <p className="text-xl font-bold text-gray-900">{kpi.value}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-12 gap-6">
        {/* ── Left: Ranking Table ── */}
        <div className="col-span-7 bg-white rounded-2xl border border-gray-100 overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
            <h2 className="text-base font-bold text-gray-900 flex items-center gap-2">
              <Trophy size={18} className="text-amber-500" />
              Classement
            </h2>
            <div className="flex items-center gap-2 text-xs text-gray-400">
              <Filter size={12} />
              Cliquez sur les en-tetes pour trier
            </div>
          </div>

          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-50 text-[11px] text-gray-400 uppercase tracking-wider">
                <th className="text-left pl-6 py-3 font-semibold">#</th>
                <th className="text-left py-3 font-semibold">Caissier</th>
                <th className="text-center py-3 font-semibold cursor-pointer select-none" onClick={() => handleSort('score')}>
                  <span className="inline-flex items-center gap-1">Score <SortIcon col="score" /></span>
                </th>
                <th className="text-right py-3 pr-3 font-semibold cursor-pointer select-none" onClick={() => handleSort('revenue')}>
                  <span className="inline-flex items-center gap-1">CA <SortIcon col="revenue" /></span>
                </th>
                <th className="text-center py-3 font-semibold cursor-pointer select-none" onClick={() => handleSort('tickets')}>
                  <span className="inline-flex items-center gap-1">Tickets <SortIcon col="tickets" /></span>
                </th>
                <th className="text-center py-3 font-semibold cursor-pointer select-none" onClick={() => handleSort('speed')}>
                  <span className="inline-flex items-center gap-1">Vitesse <SortIcon col="speed" /></span>
                </th>
                <th className="text-center py-3 pr-6 font-semibold cursor-pointer select-none" onClick={() => handleSort('voidRate')}>
                  <span className="inline-flex items-center gap-1">Annul. <SortIcon col="voidRate" /></span>
                </th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((c, idx) => {
                const badge = scoreBadge(c.score);
                const isSelected = selectedCashier === c.id;
                return (
                  <tr
                    key={c.id}
                    className={`border-b border-gray-50 cursor-pointer transition-colors ${
                      isSelected ? 'bg-bo-accent/5' : 'hover:bg-gray-50/80'
                    }`}
                    onClick={() => setSelectedCashier(c.id === selectedCashier ? null : c.id)}
                  >
                    <td className="pl-6 py-3">
                      <span className={`inline-flex items-center justify-center w-6 h-6 rounded-lg text-xs font-bold ${
                        idx === 0 ? 'bg-amber-100 text-amber-700' :
                        idx === 1 ? 'bg-gray-100 text-gray-600' :
                        idx === 2 ? 'bg-orange-100 text-orange-700' :
                        'bg-gray-50 text-gray-400'
                      }`}>
                        {idx + 1}
                      </span>
                    </td>
                    <td className="py-3">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-gradient-to-br from-bo-accent/20 to-purple-100 flex items-center justify-center">
                          <span className="text-[10px] font-bold text-bo-accent">{c.avatar}</span>
                        </div>
                        <div>
                          <p className="text-sm font-semibold text-gray-900">{c.name}</p>
                          <p className="text-[10px] text-gray-400">{c.role}</p>
                        </div>
                      </div>
                    </td>
                    <td className="text-center py-3">
                      <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-bold ${scoreColor(c.score)}`}>
                        <badge.icon size={11} className={badge.color} />
                        {c.score}
                      </span>
                    </td>
                    <td className="text-right py-3 pr-3">
                      <p className="text-sm font-semibold text-gray-900">{fmtK(c.totalRevenue)}</p>
                      <div className="flex items-center justify-end gap-0.5">
                        {changeIcon(c.revenueChange)}
                        <span className={`text-[10px] font-medium ${changeColor(c.revenueChange)}`}>
                          {c.revenueChange > 0 ? '+' : ''}{c.revenueChange}%
                        </span>
                      </div>
                    </td>
                    <td className="text-center py-3">
                      <p className="text-sm font-semibold text-gray-900">{c.ticketCount}</p>
                      <p className="text-[10px] text-gray-400">{c.ticketsPerHour}/h</p>
                    </td>
                    <td className="text-center py-3">
                      <p className="text-sm font-semibold text-gray-900">{fmtSpeed(c.avgSpeed)}</p>
                      <div className="flex items-center justify-center gap-0.5">
                        {changeIcon(-c.speedChange)}
                        <span className={`text-[10px] font-medium ${changeColor(c.speedChange, true)}`}>
                          {c.speedChange > 0 ? '+' : ''}{c.speedChange}%
                        </span>
                      </div>
                    </td>
                    <td className="text-center py-3 pr-6">
                      <p className={`text-sm font-semibold ${c.voidRate > 3 ? 'text-red-600' : c.voidRate > 2 ? 'text-amber-600' : 'text-gray-900'}`}>
                        {c.voidRate}%
                      </p>
                      <p className="text-[10px] text-gray-400">{c.voidCount} annul.</p>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* ── Right: Detail Panel ── */}
        <div className="col-span-5 space-y-4">
          {selected ? (
            <>
              {/* Profil Card */}
              <div className="bg-white rounded-2xl border border-gray-100 p-6">
                <div className="flex items-center gap-4 mb-5">
                  <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-bo-accent to-purple-600 flex items-center justify-center">
                    <span className="text-white text-lg font-bold">{selected.avatar}</span>
                  </div>
                  <div className="flex-1">
                    <h3 className="text-lg font-bold text-gray-900">{selected.name}</h3>
                    <p className="text-sm text-gray-500">{selected.role}</p>
                  </div>
                  <div className="text-right">
                    {(() => {
                      const badge = scoreBadge(selected.score);
                      return (
                        <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-xl ${scoreColor(selected.score)}`}>
                          <badge.icon size={16} className={badge.color} />
                          <span className="text-2xl font-black">{selected.score}</span>
                          <span className="text-xs font-medium">/100</span>
                        </div>
                      );
                    })()}
                  </div>
                </div>

                {/* KPI Grid */}
                <div className="grid grid-cols-3 gap-3">
                  {[
                    { label: 'CA Total', value: fmtK(selected.totalRevenue), change: selected.revenueChange, icon: Euro },
                    { label: 'Panier moy.', value: fmt(selected.avgBasket), change: selected.basketChange, icon: ShoppingCart },
                    { label: 'Tickets', value: selected.ticketCount.toString(), change: null, icon: Receipt },
                    { label: 'Vitesse moy.', value: fmtSpeed(selected.avgSpeed), change: -selected.speedChange, icon: Zap, invertChange: true },
                    { label: 'Articles/min', value: selected.itemsPerMinute.toFixed(1), change: null, icon: Package },
                    { label: 'CA/heure', value: fmtK(selected.revenuePerHour), change: null, icon: Clock },
                  ].map((kpi) => (
                    <div key={kpi.label} className="bg-gray-50 rounded-xl p-3">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-[10px] font-medium text-gray-400 uppercase">{kpi.label}</span>
                        <kpi.icon size={12} className="text-gray-300" />
                      </div>
                      <p className="text-base font-bold text-gray-900">{kpi.value}</p>
                      {kpi.change !== null && (
                        <div className="flex items-center gap-0.5 mt-0.5">
                          {changeIcon(kpi.change)}
                          <span className={`text-[10px] font-medium ${changeColor(kpi.change)}`}>
                            {kpi.change > 0 ? '+' : ''}{kpi.change}%
                          </span>
                          <span className="text-[10px] text-gray-300 ml-1">vs sem. prec.</span>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {/* Hourly Chart (simplified bar representation) */}
              <div className="bg-white rounded-2xl border border-gray-100 p-6">
                <h4 className="text-sm font-bold text-gray-900 mb-4 flex items-center gap-2">
                  <BarChart3 size={14} className="text-bo-accent" />
                  Repartition horaire
                </h4>
                <div className="space-y-2">
                  {selected.hourlySplit.map((h) => {
                    const maxRev = Math.max(...selected.hourlySplit.map((x) => x.revenue));
                    const pct = maxRev > 0 ? (h.revenue / maxRev) * 100 : 0;
                    return (
                      <div key={h.hour} className="flex items-center gap-3">
                        <span className="text-xs font-mono text-gray-400 w-8">{h.hour}</span>
                        <div className="flex-1 bg-gray-100 rounded-full h-5 relative overflow-hidden">
                          <div
                            className="h-full bg-gradient-to-r from-bo-accent to-purple-500 rounded-full transition-all duration-500"
                            style={{ width: `${pct}%` }}
                          />
                          <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] font-bold text-gray-600">
                            {fmtK(h.revenue)}
                          </span>
                        </div>
                        <span className="text-[10px] text-gray-400 w-12 text-right">{h.tickets} tx</span>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Annulations detail */}
              <div className="bg-white rounded-2xl border border-gray-100 p-6">
                <h4 className="text-sm font-bold text-gray-900 mb-3 flex items-center gap-2">
                  <Ban size={14} className={selected.voidRate > 3 ? 'text-red-500' : 'text-gray-400'} />
                  Annulations
                </h4>
                <div className="flex items-center gap-6">
                  <div>
                    <p className={`text-2xl font-black ${selected.voidRate > 3 ? 'text-red-600' : selected.voidRate > 2 ? 'text-amber-600' : 'text-gray-900'}`}>
                      {selected.voidRate}%
                    </p>
                    <p className="text-[10px] text-gray-400">Taux annulation</p>
                  </div>
                  <div className="h-10 w-px bg-gray-200" />
                  <div>
                    <p className="text-2xl font-black text-gray-900">{selected.voidCount}</p>
                    <p className="text-[10px] text-gray-400">Annulations totales</p>
                  </div>
                  <div className="h-10 w-px bg-gray-200" />
                  <div>
                    <p className="text-2xl font-black text-gray-900">{selected.totalHoursWorked.toFixed(1)}h</p>
                    <p className="text-[10px] text-gray-400">Heures travaillees</p>
                  </div>
                </div>
                {selected.voidRate > 3 && (
                  <div className="mt-3 bg-red-50 border border-red-100 rounded-xl px-4 py-2.5 text-xs text-red-700 font-medium flex items-center gap-2">
                    <Ban size={12} />
                    Taux d'annulation eleve — surveiller de pres
                  </div>
                )}
              </div>
            </>
          ) : (
            /* Empty state */
            <div className="bg-white rounded-2xl border border-gray-100 p-12 text-center">
              <div className="w-16 h-16 rounded-3xl bg-gray-100 flex items-center justify-center mx-auto mb-4">
                <User size={24} className="text-gray-300" />
              </div>
              <h3 className="text-base font-bold text-gray-400">Selectionnez un caissier</h3>
              <p className="text-sm text-gray-300 mt-1">
                Cliquez sur une ligne pour voir le detail de ses performances
              </p>
            </div>
          )}
        </div>
      </div>

      {/* ── Team Comparison Bar ── */}
      <div className="bg-white rounded-2xl border border-gray-100 p-6">
        <h2 className="text-base font-bold text-gray-900 mb-4 flex items-center gap-2">
          <Activity size={16} className="text-bo-accent" />
          Comparaison equipe — Score global
        </h2>
        <div className="space-y-3">
          {[...cashiers].sort((a, b) => b.score - a.score).map((c, idx) => {
            const badge = scoreBadge(c.score);
            return (
              <div key={c.id} className="flex items-center gap-4">
                <span className={`inline-flex items-center justify-center w-6 h-6 rounded-lg text-xs font-bold ${
                  idx === 0 ? 'bg-amber-100 text-amber-700' :
                  idx === 1 ? 'bg-gray-100 text-gray-600' :
                  idx === 2 ? 'bg-orange-100 text-orange-700' :
                  'bg-gray-50 text-gray-400'
                }`}>
                  {idx + 1}
                </span>
                <div className="w-32 truncate">
                  <p className="text-sm font-semibold text-gray-800">{c.name}</p>
                </div>
                <div className="flex-1 bg-gray-100 rounded-full h-6 relative overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-700 ${
                      c.score >= 85 ? 'bg-gradient-to-r from-emerald-400 to-emerald-500' :
                      c.score >= 70 ? 'bg-gradient-to-r from-blue-400 to-blue-500' :
                      c.score >= 50 ? 'bg-gradient-to-r from-amber-400 to-amber-500' :
                      'bg-gradient-to-r from-red-400 to-red-500'
                    }`}
                    style={{ width: `${c.score}%` }}
                  />
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs font-bold text-white mix-blend-difference">
                    {c.score}/100
                  </span>
                </div>
                <div className="flex items-center gap-1 w-20">
                  <badge.icon size={12} className={badge.color} />
                  <span className="text-xs font-medium text-gray-500">{badge.label}</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
