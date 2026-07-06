import React, { useState, useEffect, useCallback } from 'react';
import {
  Calendar,
  FileText,
  TrendingUp,
  ShoppingCart,
  Target,
  CreditCard,
  ReceiptText,
  ArrowDown,
  ArrowUp,
  Download,
  Printer,
  Clock,
  Trophy,
  Percent,
  XCircle,
  Loader2,
  AlertCircle,
  CalendarRange,
} from 'lucide-react';
import { reportsApi } from '../services/api';
import { useCurrentStoreId } from '../hooks/useCurrentStoreId';
import {
  RANGE_PRESETS,
  computePreset,
  isRangeValid,
  isSingleDay,
  matchPreset,
  rangeTitle,
  frDate,
  toIso,
  type RangePreset,
} from '../utils/reportRange';

interface PeakHour { hour: string; count: number }

/** Unified view model — filled from either a daily Z-report or a period summary. */
interface ReportView {
  totalRevenue: number;
  totalTax: number;
  cashTotal: number;
  cardTotal: number;
  transactionCount: number;
  avgBasket: number;
  voidCount: number;
  discountTotal: number;
  peakHours: PeakHour[];
  topProducts: { name: string; qty: number; revenue: number }[];
  comparison: { revenueChange: number | null; transactionChange: number | null; basketChange: number | null };
}

interface PeriodDayView {
  date: string;
  revenue: number;
  tx: number;
  avg: number;
  tax: number;
  card: number;
  cash: number;
  discount: number;
  voids: number;
}

const emptyView: ReportView = {
  totalRevenue: 0, totalTax: 0, cashTotal: 0, cardTotal: 0,
  transactionCount: 0, avgBasket: 0, voidCount: 0, discountTotal: 0,
  peakHours: [], topProducts: [],
  comparison: { revenueChange: null, transactionChange: null, basketChange: null },
};

export function ReportsPage() {
  const today = new Date();
  const todayIso = toIso(today);

  const [startDate, setStartDate] = useState(todayIso);
  const [endDate, setEndDate] = useState(todayIso);
  const [activeTab, setActiveTab] = useState<'z-report' | 'analytics'>('z-report');
  const [view, setView] = useState<ReportView>(emptyView);
  const [days, setDays] = useState<PeriodDayView[]>([]);
  const [storeName, setStoreName] = useState<string | null>(null);
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rangeError, setRangeError] = useState<string | null>(null);
  const [noData, setNoData] = useState(false);

  const storeId = useCurrentStoreId();

  const single = isSingleDay(startDate, endDate);
  const validRange = isRangeValid(startDate, endDate);
  const activePreset: RangePreset = matchPreset(startDate, endDate, today);

  /** Single-day path — fetch the sealed Z-report (unchanged behaviour). */
  const fetchZReport = useCallback(async (date: string) => {
    if (!storeId) return;
    try {
      setLoading(true); setError(null); setNoData(false); setDays([]);
      const res = await reportsApi.getZReport(storeId, date);
      const data = res.data;
      if (!data || (data.transactionCount === 0 && data.totalRevenue === 0)) {
        setNoData(true); setView(emptyView);
      } else {
        setView({
          totalRevenue: (data.totalRevenue || 0) / 100,
          totalTax: (data.totalTax || data.taxTotal || 0) / 100,
          cashTotal: (data.cashTotal || 0) / 100,
          cardTotal: (data.cardTotal || 0) / 100,
          transactionCount: data.transactionCount || 0,
          avgBasket: (data.avgBasket || 0) / 100,
          voidCount: data.voidCount || 0,
          discountTotal: (data.discountTotal || 0) / 100,
          topProducts: (data.topProducts || []).map((p: any) => ({
            name: p.name || p.productName || '', qty: p.qty || p.quantity || 0, revenue: (p.revenue || 0) / 100,
          })),
          peakHours: (data.peakHours || data.hourlyBreakdown || []).map((h: any) => ({
            hour: h.hour || `${h.h}h`, count: h.count || h.transactions || 0,
          })),
          comparison: {
            revenueChange: data.comparison?.revenueChange ?? null,
            transactionChange: data.comparison?.transactionChange ?? null,
            basketChange: data.comparison?.basketChange ?? null,
          },
        });
        setNoData(false);
      }
      setGeneratedAt(null);
    } catch (err: any) {
      if (err.response?.status === 404) { setNoData(true); setView(emptyView); }
      else setError(err.response?.data?.message || 'Erreur lors du chargement du rapport');
    } finally {
      setLoading(false);
    }
  }, [storeId]);

  /** Multi-day path — fetch the read-only period analytics summary. */
  const fetchPeriod = useCallback(async (start: string, end: string) => {
    if (!storeId) return;
    try {
      setLoading(true); setError(null); setNoData(false);
      const res = await reportsApi.periodSummary(storeId, start, end);
      const d = res.data;
      setStoreName(d.storeName ?? null);
      setGeneratedAt(d.generatedAt ?? null);
      setView({
        totalRevenue: (d.totalRevenueMinorUnits || 0) / 100,
        totalTax: (d.totalTaxMinorUnits || 0) / 100,
        cashTotal: (d.cashTotalMinorUnits || 0) / 100,
        cardTotal: (d.cardTotalMinorUnits || 0) / 100,
        transactionCount: d.transactionCount || 0,
        avgBasket: (d.averageBasketMinorUnits || 0) / 100,
        voidCount: d.voidCount || 0,
        discountTotal: (d.discountTotalMinorUnits || 0) / 100,
        topProducts: [],
        peakHours: (d.peakHours || [])
          .slice()
          .sort((a: any, b: any) => a.hour - b.hour)
          .map((h: any) => ({ hour: `${h.hour}h`, count: h.transactionCount || 0 })),
        comparison: { revenueChange: null, transactionChange: null, basketChange: null },
      });
      setDays((d.days || []).map((day: any) => ({
        date: day.date,
        revenue: (day.totalRevenueMinorUnits || 0) / 100,
        tx: day.transactionCount || 0,
        avg: (day.averageBasketMinorUnits || 0) / 100,
        tax: (day.totalTaxMinorUnits || 0) / 100,
        card: (day.cardTotalMinorUnits || 0) / 100,
        cash: (day.cashTotalMinorUnits || 0) / 100,
        discount: (day.discountTotalMinorUnits || 0) / 100,
        voids: day.voidCount || 0,
      })));
      setNoData((d.transactionCount || 0) === 0);
    } catch (err: any) {
      setError(err.response?.data?.message || 'Erreur lors du chargement du rapport période');
      setView(emptyView); setDays([]);
    } finally {
      setLoading(false);
    }
  }, [storeId]);

  // Load whenever the range changes and is valid.
  useEffect(() => {
    if (!validRange) {
      setRangeError('La date de fin ne peut pas être antérieure à la date de début.');
      return;
    }
    setRangeError(null);
    if (single) fetchZReport(startDate);
    else fetchPeriod(startDate, endDate);
  }, [startDate, endDate, single, validRange, fetchZReport, fetchPeriod]);

  const applyPreset = (preset: RangePreset) => {
    if (preset === 'custom') return;
    const r = computePreset(preset, new Date());
    setStartDate(r.start);
    setEndDate(r.end);
  };

  const handleGenerate = async () => {
    if (!storeId || !validRange) return;
    if (single) {
      try {
        setGenerating(true);
        await reportsApi.generateZReport(storeId, startDate);
        await fetchZReport(startDate);
      } catch (err: any) {
        alert(err.response?.data?.message || 'Erreur lors de la generation du rapport');
      } finally {
        setGenerating(false);
      }
    } else {
      // A period report is read-only analytics — "generate" = (re)compute + show.
      await fetchPeriod(startDate, endDate);
    }
  };

  const handleExportCsv = () => {
    // Period → per-day CSV; single day → top-products CSV.
    let header: string[]; let rows: string[][]; let filename: string;
    if (!single && days.length > 0) {
      header = ['Date', 'CA (EUR)', 'Transactions', 'Panier moyen (EUR)', 'TVA (EUR)', 'CB (EUR)', 'Especes (EUR)', 'Remises (EUR)', 'Annulations'];
      rows = days.map((d) => [
        frDate(d.date), d.revenue.toFixed(2), String(d.tx), d.avg.toFixed(2),
        d.tax.toFixed(2), d.card.toFixed(2), d.cash.toFixed(2), d.discount.toFixed(2), String(d.voids),
      ]);
      filename = `rapport-periode-${startDate}_${endDate}.csv`;
    } else if (view.topProducts.length > 0) {
      header = ['Rang', 'Produit', 'Quantite', "Chiffre d'affaires (EUR)", 'Part (%)'];
      rows = view.topProducts.map((p, i) => {
        const share = view.totalRevenue > 0 ? Math.round((p.revenue / view.totalRevenue) * 100) : 0;
        return [String(i + 1), p.name, String(p.qty), p.revenue.toFixed(2), String(share)];
      });
      filename = `top-produits-${startDate}.csv`;
    } else {
      return;
    }
    const escapeCell = (v: string) => `"${v.replace(/"/g, '""')}"`;
    const csv = [header, ...rows].map((r) => r.map(escapeCell).join(',')).join('\r\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const maxCount = view.peakHours.length > 0 ? Math.max(...view.peakHours.map((h) => h.count)) : 1;
  const cardPercent = view.totalRevenue > 0 ? Math.round((view.cardTotal / view.totalRevenue) * 100) : 0;
  const formatCurrency = (n: number) =>
    n.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';

  const title = validRange ? rangeTitle(startDate, endDate) : 'Période invalide';

  return (
    <div className="p-8 space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-2xl font-bold text-bo-text">Rapports</h2>
          <p className="text-gray-400 mt-1 text-sm flex items-center gap-2">
            {single ? <FileText size={14} /> : <CalendarRange size={14} />}
            {title}
            {storeName && !single && <span className="text-gray-300">· {storeName}</span>}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative">
            <Calendar size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="date" aria-label="Date de début"
              className="pl-9 pr-3 py-2.5 rounded-xl border border-gray-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-bo-accent/30"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
            />
          </div>
          <span className="text-gray-400 text-sm">au</span>
          <div className="relative">
            <Calendar size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="date" aria-label="Date de fin"
              className="pl-9 pr-3 py-2.5 rounded-xl border border-gray-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-bo-accent/30"
              value={endDate}
              min={startDate}
              onChange={(e) => setEndDate(e.target.value)}
            />
          </div>
          <button
            onClick={() => window.print()}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl border border-gray-200 text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors"
            title="Imprimer le rapport affiché"
          >
            <Printer size={16} />
            Imprimer
          </button>
          <button
            onClick={handleGenerate}
            disabled={generating || !validRange}
            className="flex items-center gap-2 bg-bo-accent text-white px-5 py-2.5 rounded-xl font-medium hover:bg-bo-accent/90 transition-colors shadow-lg shadow-bo-accent/25 disabled:opacity-50"
          >
            {generating ? <Loader2 size={16} className="animate-spin" /> : <FileText size={16} />}
            {single ? 'Generer Z-Report' : 'Generer rapport periode'}
          </button>
        </div>
      </div>

      {/* Quick presets */}
      <div className="flex flex-wrap gap-2">
        {RANGE_PRESETS.map((p) => (
          <button
            key={p.id}
            onClick={() => applyPreset(p.id)}
            disabled={p.id === 'custom'}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              activePreset === p.id
                ? 'bg-bo-accent text-white shadow-sm'
                : p.id === 'custom'
                  ? 'bg-gray-50 text-gray-400 cursor-default'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>

      {/* Tab selector */}
      <div className="flex gap-1 bg-gray-100 rounded-xl p-1 w-fit">
        {[
          { id: 'z-report' as const, label: single ? 'Rapport Z' : 'Rapport période', icon: single ? ReceiptText : CalendarRange },
          { id: 'analytics' as const, label: 'Analytique', icon: TrendingUp },
        ].map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                activeTab === tab.id ? 'bg-white text-bo-text shadow-sm' : 'text-gray-400 hover:text-gray-600'
              }`}
            >
              <Icon size={15} />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Range error */}
      {rangeError && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-700 flex items-center gap-2">
          <AlertCircle size={16} />
          {rangeError}
        </div>
      )}

      {/* Load error */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-700 flex items-center gap-2">
          <AlertCircle size={16} />
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center h-64">
          <Loader2 size={32} className="animate-spin text-bo-accent" />
        </div>
      ) : activeTab === 'z-report' && validRange ? (
        <>
          {noData && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-700 flex items-center gap-2">
              <AlertCircle size={16} />
              {single
                ? 'Aucun rapport disponible pour cette date. Cliquez sur "Generer Z-Report" pour en creer un.'
                : 'Aucune vente sur cette période.'}
            </div>
          )}

          {/* Summary cards */}
          <div className="grid grid-cols-4 gap-4">
            {[
              { label: "Chiffre d'affaires", value: formatCurrency(view.totalRevenue), icon: TrendingUp, color: 'text-bo-accent bg-indigo-50', change: view.comparison.revenueChange },
              { label: 'Transactions', value: String(view.transactionCount), icon: ShoppingCart, color: 'text-emerald-600 bg-emerald-50', change: view.comparison.transactionChange },
              { label: 'Panier moyen', value: formatCurrency(view.avgBasket), icon: Target, color: 'text-amber-600 bg-amber-50', change: view.comparison.basketChange },
              { label: 'TVA collectee', value: formatCurrency(view.totalTax), icon: Percent, color: 'text-cyan-600 bg-cyan-50', change: null },
            ].map((card) => {
              const Icon = card.icon;
              return (
                <div key={card.label} className="bg-white rounded-2xl p-5 shadow-soft border border-gray-100/50">
                  <div className="flex items-center justify-between mb-3">
                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${card.color}`}>
                      <Icon size={18} />
                    </div>
                    {card.change !== null && (
                      <span className={`flex items-center gap-0.5 text-xs font-semibold px-2 py-0.5 rounded-full ${card.change >= 0 ? 'text-emerald-600 bg-emerald-50' : 'text-red-500 bg-red-50'}`}>
                        {card.change >= 0 ? <ArrowUp size={12} /> : <ArrowDown size={12} />}
                        {Math.abs(card.change)}%
                      </span>
                    )}
                  </div>
                  <p className="text-2xl font-bold text-bo-text">{card.value}</p>
                  <p className="text-xs text-gray-400 mt-1">{card.label}</p>
                </div>
              );
            })}
          </div>

          <div className="grid grid-cols-2 gap-6">
            {/* Payment breakdown */}
            <div className="bg-white rounded-2xl p-6 shadow-soft border border-gray-100/50">
              <h3 className="font-semibold text-bo-text mb-5 flex items-center gap-2">
                <CreditCard size={16} className="text-bo-accent" />
                Moyens de paiement
              </h3>
              <div className="flex items-center gap-6 mb-5">
                <div className="relative w-28 h-28 flex-shrink-0">
                  <svg viewBox="0 0 36 36" className="w-full h-full -rotate-90">
                    <circle cx="18" cy="18" r="15.5" fill="none" stroke="#e5e7eb" strokeWidth="3" />
                    <circle cx="18" cy="18" r="15.5" fill="none" stroke="#6366f1" strokeWidth="3"
                      strokeDasharray={`${cardPercent} ${100 - cardPercent}`} strokeLinecap="round" />
                  </svg>
                  <div className="absolute inset-0 flex flex-col items-center justify-center">
                    <span className="text-lg font-bold text-bo-text">{cardPercent}%</span>
                    <span className="text-[10px] text-gray-400">Carte</span>
                  </div>
                </div>
                <div className="flex-1 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="w-3 h-3 rounded-full bg-bo-accent" />
                      <span className="text-sm text-gray-600">Carte bancaire</span>
                    </div>
                    <span className="text-sm font-semibold">{formatCurrency(view.cardTotal)}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="w-3 h-3 rounded-full bg-emerald-500" />
                      <span className="text-sm text-gray-600">Especes</span>
                    </div>
                    <span className="text-sm font-semibold">{formatCurrency(view.cashTotal)}</span>
                  </div>
                </div>
              </div>
              <div className="space-y-2 pt-4 border-t border-gray-100">
                <div className="flex justify-between text-sm">
                  <span className="flex items-center gap-2 text-gray-500">
                    <Percent size={13} className="text-amber-500" />
                    Remises totales
                  </span>
                  <span className="text-amber-600 font-semibold">-{formatCurrency(view.discountTotal)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="flex items-center gap-2 text-gray-500">
                    <XCircle size={13} className="text-red-400" />
                    Annulations
                  </span>
                  <span className="text-red-500 font-semibold">{view.voidCount}</span>
                </div>
              </div>
            </div>

            {/* Peak hours */}
            <div className="bg-white rounded-2xl p-6 shadow-soft border border-gray-100/50">
              <h3 className="font-semibold text-bo-text mb-5 flex items-center gap-2">
                <Clock size={16} className="text-bo-accent" />
                Heures de pointe {single ? '' : '(période)'}
              </h3>
              {view.peakHours.length > 0 ? (
                <>
                  <div className="flex items-end gap-2 h-44">
                    {view.peakHours.map((h) => {
                      const heightPct = (h.count / maxCount) * 100;
                      const isMax = h.count === maxCount;
                      return (
                        <div key={h.hour} className="flex-1 flex flex-col items-center gap-1.5 group">
                          <span className={`text-xs font-semibold ${isMax ? 'text-bo-accent' : 'text-gray-400'}`}>{h.count}</span>
                          <div className="w-full relative flex items-end" style={{ height: '120px' }}>
                            <div className={`w-full rounded-t-lg transition-all duration-500 ${isMax ? 'bg-gradient-to-t from-bo-accent to-indigo-400' : 'bg-gradient-to-t from-indigo-200 to-indigo-100'}`}
                              style={{ height: `${heightPct}%`, minHeight: '6px' }} />
                          </div>
                          <span className={`text-[11px] font-medium ${isMax ? 'text-bo-accent' : 'text-gray-400'}`}>{h.hour}</span>
                        </div>
                      );
                    })}
                  </div>
                  <div className="mt-4 pt-3 border-t border-gray-100 flex items-center justify-between text-xs text-gray-400">
                    <span>Heure la plus dense: {view.peakHours.reduce((max, h) => h.count > max.count ? h : max, view.peakHours[0])?.hour}</span>
                    <span className="text-bo-accent font-semibold">{maxCount} transactions</span>
                  </div>
                </>
              ) : (
                <div className="h-44 flex items-center justify-center text-gray-300 text-sm">Aucune donnee disponible</div>
              )}
            </div>
          </div>

          {/* Per-day detail (period only) */}
          {!single && days.length > 0 && (
            <div className="bg-white rounded-2xl p-6 shadow-soft border border-gray-100/50">
              <div className="flex items-center justify-between mb-5">
                <h3 className="font-semibold text-bo-text flex items-center gap-2">
                  <CalendarRange size={16} className="text-bo-accent" />
                  Détail par jour
                </h3>
                <button onClick={handleExportCsv} className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-bo-accent transition-colors" title="Exporter le détail journalier en CSV">
                  <Download size={13} />
                  Exporter CSV
                </button>
              </div>
              <div className="overflow-x-auto rounded-xl border border-gray-100">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50/50 text-xs font-semibold text-gray-400 uppercase tracking-wider">
                      <th className="text-left py-3 px-4">Date</th>
                      <th className="text-right py-3 px-4">CA</th>
                      <th className="text-right py-3 px-4">Tx</th>
                      <th className="text-right py-3 px-4">Panier moy.</th>
                      <th className="text-right py-3 px-4">TVA</th>
                      <th className="text-right py-3 px-4">CB</th>
                      <th className="text-right py-3 px-4">Especes</th>
                      <th className="text-right py-3 px-4">Remises</th>
                      <th className="text-right py-3 px-4">Annul.</th>
                    </tr>
                  </thead>
                  <tbody>
                    {days.map((d) => (
                      <tr key={d.date} className={`border-t border-gray-50 hover:bg-gray-50/50 ${d.tx === 0 ? 'text-gray-300' : ''}`}>
                        <td className="py-2.5 px-4 font-medium text-bo-text">{frDate(d.date)}</td>
                        <td className="py-2.5 px-4 text-right font-semibold">{formatCurrency(d.revenue)}</td>
                        <td className="py-2.5 px-4 text-right">{d.tx}</td>
                        <td className="py-2.5 px-4 text-right">{formatCurrency(d.avg)}</td>
                        <td className="py-2.5 px-4 text-right">{formatCurrency(d.tax)}</td>
                        <td className="py-2.5 px-4 text-right">{formatCurrency(d.card)}</td>
                        <td className="py-2.5 px-4 text-right">{formatCurrency(d.cash)}</td>
                        <td className="py-2.5 px-4 text-right text-amber-600">{d.discount > 0 ? `-${formatCurrency(d.discount)}` : '—'}</td>
                        <td className="py-2.5 px-4 text-right">{d.voids || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 border-gray-100 bg-gray-50/40 font-semibold">
                      <td className="py-3 px-4">Total période</td>
                      <td className="py-3 px-4 text-right text-bo-accent">{formatCurrency(view.totalRevenue)}</td>
                      <td className="py-3 px-4 text-right">{view.transactionCount}</td>
                      <td className="py-3 px-4 text-right">{formatCurrency(view.avgBasket)}</td>
                      <td className="py-3 px-4 text-right">{formatCurrency(view.totalTax)}</td>
                      <td className="py-3 px-4 text-right">{formatCurrency(view.cardTotal)}</td>
                      <td className="py-3 px-4 text-right">{formatCurrency(view.cashTotal)}</td>
                      <td className="py-3 px-4 text-right text-amber-600">-{formatCurrency(view.discountTotal)}</td>
                      <td className="py-3 px-4 text-right">{view.voidCount}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          )}

          {/* Top products (single day only) */}
          {single && view.topProducts.length > 0 && (
            <div className="bg-white rounded-2xl p-6 shadow-soft border border-gray-100/50">
              <div className="flex items-center justify-between mb-5">
                <h3 className="font-semibold text-bo-text flex items-center gap-2">
                  <Trophy size={16} className="text-amber-500" />
                  Top produits de la journee
                </h3>
                <button onClick={handleExportCsv} className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-bo-accent transition-colors" title="Exporter les top produits en CSV">
                  <Download size={13} />
                  Exporter CSV
                </button>
              </div>
              <div className="overflow-hidden rounded-xl border border-gray-100">
                <table className="w-full">
                  <thead>
                    <tr className="bg-gray-50/50">
                      <th className="text-left py-3 px-4 text-xs font-semibold text-gray-400 uppercase tracking-wider w-8">#</th>
                      <th className="text-left py-3 px-4 text-xs font-semibold text-gray-400 uppercase tracking-wider">Produit</th>
                      <th className="text-right py-3 px-4 text-xs font-semibold text-gray-400 uppercase tracking-wider">Quantite</th>
                      <th className="text-right py-3 px-4 text-xs font-semibold text-gray-400 uppercase tracking-wider">Chiffre d'affaires</th>
                      <th className="text-right py-3 px-4 text-xs font-semibold text-gray-400 uppercase tracking-wider">Part</th>
                    </tr>
                  </thead>
                  <tbody>
                    {view.topProducts.map((p, i) => {
                      const share = view.totalRevenue > 0 ? Math.round((p.revenue / view.totalRevenue) * 100) : 0;
                      return (
                        <tr key={i} className="border-t border-gray-50 hover:bg-gray-50/50 transition-colors">
                          <td className="py-3 px-4">
                            <span className={`w-6 h-6 rounded-lg flex items-center justify-center text-xs font-bold ${i === 0 ? 'bg-amber-100 text-amber-700' : i === 1 ? 'bg-gray-100 text-gray-600' : i === 2 ? 'bg-orange-100 text-orange-600' : 'bg-gray-50 text-gray-400'}`}>{i + 1}</span>
                          </td>
                          <td className="py-3 px-4 font-medium text-sm text-bo-text">{p.name}</td>
                          <td className="py-3 px-4 text-right text-sm">
                            <span className="bg-indigo-50 text-bo-accent text-xs font-semibold px-2.5 py-1 rounded-lg">{p.qty} vendus</span>
                          </td>
                          <td className="py-3 px-4 text-right font-semibold text-sm">{formatCurrency(p.revenue)}</td>
                          <td className="py-3 px-4 text-right">
                            <div className="flex items-center justify-end gap-2">
                              <div className="w-16 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                                <div className="h-full bg-bo-accent rounded-full" style={{ width: `${share}%` }} />
                              </div>
                              <span className="text-xs text-gray-400 font-medium w-8 text-right">{share}%</span>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Control / signature zone (period report) */}
          {!single && !noData && (
            <div className="bg-white rounded-2xl p-6 shadow-soft border border-gray-100/50 text-xs text-gray-400">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <span>{title}{storeName ? ` · ${storeName}` : ''}</span>
                {generatedAt && <span>Généré le {new Date(generatedAt).toLocaleString('fr-FR')}</span>}
              </div>
              <div className="mt-4 pt-4 border-t border-dashed border-gray-200 flex items-end justify-between">
                <span>Rapport analytique période — non fiscal (le Z-Report journalier reste la pièce de clôture).</span>
                <span className="text-gray-300">Visa / contrôle : ____________________</span>
              </div>
            </div>
          )}
        </>
      ) : activeTab === 'analytics' ? (
        <div className="bg-white rounded-2xl p-12 shadow-soft border border-gray-100/50 text-center">
          <TrendingUp size={48} className="mx-auto text-gray-200 mb-4" />
          <h3 className="text-lg font-semibold text-bo-text mb-2">Analytique avancee</h3>
          <p className="text-gray-400 text-sm max-w-md mx-auto">
            Connectez le backend pour acceder aux analyses avancees : tendances mensuelles,
            comparaisons inter-magasins, predictions de ventes et rapports personnalises.
          </p>
          <button disabled title="Bientôt disponible" className="mt-6 px-6 py-2.5 rounded-xl bg-gray-100 text-gray-400 text-sm font-medium cursor-not-allowed">
            Bientôt disponible
          </button>
        </div>
      ) : null}
    </div>
  );
}
