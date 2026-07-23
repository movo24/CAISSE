import React, { useState, useMemo } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuthStore } from '../stores/authStore';
import { Tw24SyncToggle } from '../components/Tw24SyncToggle';
import {
  TrendingUp, TrendingDown, ShoppingCart, Target, AlertTriangle,
  ArrowUpRight, ArrowDownRight, CreditCard, Banknote, Clock,
  Users, Zap, Brain, ChevronRight, ChevronDown, ChevronUp,
  BarChart3, Timer, Receipt, Euro, Lightbulb,
  Package, AlertCircle, Layers, PieChart,
  UserCheck, XCircle, RefreshCw, Shield, FileText,
  Download, CalendarDays, Building2, Activity,
  Flame, Snowflake, Percent,
  RotateCcw, Ban, Gift, Calculator, Scale,
  ShieldAlert, Fingerprint, ScanEye, CircleDot, History,
  AlertOctagon, BarChart2,
  Loader2,
} from 'lucide-react';
import { useDashboardData } from '../hooks/useDashboardData';
import { ProductScanPanel } from '../components/ProductScanPanel';
// Logos OFFICIELS (mêmes fichiers que la caisse — jamais recréés, jamais de texte de substitution)
import wesleysLogoUrl from '../assets/wesleys-logo.png';
import addxLogoUrl from '../assets/addx-logo.png';

const WEEK_DAYS = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];
const MONTHS_SHORT = ['Jan', 'Fev', 'Mar', 'Avr', 'Mai', 'Jun', 'Jul', 'Aou', 'Sep', 'Oct', 'Nov', 'Dec'];
const today = new Date().getDay();
const dayIndex = today === 0 ? 6 : today - 1;

/* Data is fetched via useDashboardData hook */

/* ═══════════════════════════════════════════════════════════════
   HELPERS
   ═══════════════════════════════════════════════════════════════ */

const fmt = (minorUnits: number) =>
  (minorUnits / 100).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' \u20ac';

const fmtK = (minorUnits: number) => {
  const v = minorUnits / 100;
  if (v >= 1000) return (v / 1000).toFixed(1).replace('.', ',') + ' k\u20ac';
  return v.toFixed(0) + ' \u20ac';
};

const fmtPct = (v: number) => (v >= 0 ? '+' : '') + v.toFixed(1) + '%';

const variation = (current: number, previous: number) => {
  if (previous === 0) return { pct: 0, label: '—', positive: true };
  const pct = ((current - previous) / previous) * 100;
  return { pct, label: fmtPct(pct), positive: pct >= 0 };
};

const colorBadge = (positive: boolean) =>
  positive
    ? 'bg-emerald-50 text-emerald-700 ring-emerald-200'
    : 'bg-red-50 text-red-700 ring-red-200';

const VariationBadge = ({ current, previous }: { current: number; previous: number }) => {
  const v = variation(current, previous);
  return (
    <span className={`inline-flex items-center gap-0.5 text-[11px] font-semibold px-2 py-0.5 rounded-full ring-1 ${colorBadge(v.positive)}`}>
      {v.positive ? <ArrowUpRight size={11} /> : <ArrowDownRight size={11} />}
      {v.label}
    </span>
  );
};

/* ═══════════════════════════════════════════════════════════════
   SECTION HEADER COMPONENT
   ═══════════════════════════════════════════════════════════════ */

function SectionHeader({ icon: Icon, title, subtitle, color }: {
  icon: React.ElementType;
  title: string;
  subtitle: string;
  color: string;
}) {
  return (
    <div className="flex items-center gap-3 mb-5">
      <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${color}`}>
        <Icon size={18} className="text-white" />
      </div>
      <div>
        <h3 className="text-lg font-bold text-bo-text">{title}</h3>
        <p className="text-xs text-gray-400">{subtitle}</p>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   MINI KPI CARD
   ═══════════════════════════════════════════════════════════════ */

function KpiCard({ label, value, sub, icon: Icon, color, trend }: {
  label: string;
  value: string;
  sub?: string;
  icon: React.ElementType;
  color: string;
  trend?: { current: number; previous: number };
}) {
  // Garde-fou : jamais 'undefined' / 'NaN' / 'null' affiché → '—'.
  const safeValue = value == null || /undefined|NaN|null/i.test(String(value)) ? '—' : value;
  return (
    <div className="bg-white rounded-2xl p-4 shadow-soft border border-gray-100/50 hover:shadow-card transition-shadow">
      <div className="flex items-start justify-between mb-2">
        <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${color}`}>
          <Icon size={16} />
        </div>
        {trend && <VariationBadge current={trend.current} previous={trend.previous} />}
      </div>
      <p className="text-xl font-black text-bo-text mt-1">{safeValue}</p>
      <p className="text-[11px] text-gray-400 font-medium mt-0.5">{label}</p>
      {sub && <p className="text-[10px] text-gray-300 mt-0.5">{sub}</p>}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   HORIZONTAL BAR
   ═══════════════════════════════════════════════════════════════ */

function HBar({ label, value, pct, color }: { label: string; value: string; pct: number; color: string }) {
  return (
    <div>
      <div className="flex justify-between text-sm mb-1">
        <span className="text-gray-600 font-medium">{label}</span>
        <span className="font-semibold text-bo-text">{value}</span>
      </div>
      <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
        <div className={`h-full ${color} rounded-full transition-all duration-700`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   MAIN COMPONENT
   ═══════════════════════════════════════════════════════════════ */

export function DashboardPage() {
  const { employee, currentStoreId } = useAuthStore();

  // ALL hooks MUST be called before any conditional return (React rules of hooks)
  const {
    loading,
    perfData, topProducts, flopProducts, productCategories,
    stockAlerts, dormantProducts, productStats,
    cashierData, caisseStats, zReports,
    paymentData, aiInsights,
    cashierCashControl, cashControlAlertHistory, interStoreComparison,
    stores,
  } = useDashboardData();
  const [productView, setProductView] = useState<'top' | 'flop'>('top');
  const [showAllCashiers, setShowAllCashiers] = useState(false);
  const [showZHistory, setShowZHistory] = useState(false);
  const [showAlertHistory, setShowAlertHistory] = useState(false);
  const [dateFilter, setDateFilter] = useState('today');
  const [storeFilter, setStoreFilter] = useState('all');

  // Note: removed auto-redirect to /network.
  // Admin can use the store dashboard with their home store,
  // or navigate to /network manually via the store selector.


  // Computed values
  const caParM2 = perfData.surfaceM2 > 0 ? perfData.caMois / perfData.surfaceM2 : 0;
  const caParEmploye = perfData.nbEmployes > 0 ? perfData.caMois / perfData.nbEmployes : 0;
  const objectifPct = perfData.objectifMois > 0 ? Math.round((perfData.caMois / perfData.objectifMois) * 100) : 0;

  // Find peak hour
  const peakHour = perfData.hourlyCA.length > 0
    ? perfData.hourlyCA.reduce((max, h) => h.ca > max.ca ? h : max, perfData.hourlyCA[0])
    : { h: '0', ca: 0 };
  const maxHourlyCA = peakHour.ca;

  // Current week progress
  const currentWeekTotal = perfData.weekActual.reduce((s, v) => s + v, 0);
  const weekProgressPct = perfData.weeklyObjective > 0 ? Math.round((currentWeekTotal / perfData.weeklyObjective) * 100) : 0;
  const avgDailyRealized = currentWeekTotal / (dayIndex + 1);
  const projectedWeekTotal = Math.round(avgDailyRealized * 7);

  return (
    <div className="p-6 lg:p-8 space-y-6 animate-fade-in max-w-[1600px] mx-auto">
      {/* ══════════ HEADER — identité The Wesley's × ADDX Caisse (logos officiels,
             chacun limité à sa propre largeur, jamais de bande dédiée) ══════════ */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div className="flex items-center gap-4 min-w-0">
          <img src={wesleysLogoUrl} alt="The Wesley's" draggable={false}
               className="h-9 w-auto flex-none select-none" style={{ flex: '0 0 auto' }} />
          <div className="w-px h-8 bg-gray-200 flex-none" />
          <div className="min-w-0">
            <h2 className="text-2xl font-bold text-bo-text truncate">Dashboard CEO</h2>
            <p className="text-gray-400 text-sm mt-0.5 flex items-center gap-1.5">
              Pilotage temps reel — Reseau multi-magasins
              <span className="text-gray-300">·</span>
              <img src={addxLogoUrl} alt="ADDX Caisse" draggable={false}
                   className="h-3.5 w-auto inline-block align-middle select-none opacity-90" />
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {/* Synchro TimeWin24 par magasin (Partie C) — optionnelle, admin. */}
          <Tw24SyncToggle />
          {/* Date filter */}
          <div className="flex bg-gray-100 rounded-xl p-1">
            {[
              { key: 'today', label: 'Jour' },
              { key: 'week', label: 'Semaine' },
              { key: 'month', label: 'Mois' },
              { key: 'year', label: 'Annee' },
            ].map((f) => (
              <button
                key={f.key}
                onClick={() => setDateFilter(f.key)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                  dateFilter === f.key
                    ? 'bg-white shadow-soft text-bo-text'
                    : 'text-gray-400 hover:text-gray-600'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
          {/* Store filter */}
          <select
            value={storeFilter}
            onChange={(e) => setStoreFilter(e.target.value)}
            className="text-xs font-semibold bg-white border border-gray-200 rounded-xl px-3 py-2 text-bo-text focus:ring-2 focus:ring-[#E5117A]/20 focus:border-[#E5117A]"
          >
            <option value="all">Tous les magasins</option>
            {stores.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
          {/* Export */}
          <button className="flex items-center gap-2 px-3 py-2 rounded-xl bg-white border border-gray-200 text-xs font-semibold text-gray-600 hover:border-[#E5117A] hover:text-[#E5117A] transition-all">
            <Download size={14} />
            Export
          </button>
        </div>
      </div>

      {/* ══════════ SCAN PRODUIT (code-barres) ══════════ */}
      <ProductScanPanel source="dashboard" />

      {/* ╔═══════════════════════════════════════════════════════════╗
         ║  A. PERFORMANCE COMMERCIALE                               ║
         ╚═══════════════════════════════════════════════════════════╝ */}
      <section className="space-y-4">
        <SectionHeader
          icon={TrendingUp}
          title="A. Performance Commerciale"
          subtitle="CA, objectifs, KPIs de vente en temps reel"
          color="bg-[#E5117A]"
        />

        {/* TOP KPIs ROW */}
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
          <KpiCard
            label="CA Jour"
            value={fmtK(perfData.caJour)}
            icon={Euro}
            color="text-[#E5117A] bg-indigo-50"
            trend={{ current: perfData.caJour, previous: perfData.caJourN1 }}
          />
          <KpiCard
            label="CA Semaine"
            value={fmtK(perfData.caSemaine)}
            icon={BarChart3}
            color="text-blue-600 bg-blue-50"
            trend={{ current: perfData.caSemaine, previous: perfData.caSemaineN1 }}
          />
          <KpiCard
            label="CA Mois"
            value={fmtK(perfData.caMois)}
            icon={CalendarDays}
            color="text-violet-600 bg-violet-50"
            trend={{ current: perfData.caMois, previous: perfData.caMoisN1 }}
          />
          <KpiCard
            label="CA Annee"
            value={fmtK(perfData.caAnnee)}
            icon={TrendingUp}
            color="text-emerald-600 bg-emerald-50"
            trend={{ current: perfData.caAnnee, previous: perfData.caAnneeN1 }}
          />
          <KpiCard
            label="Panier Moyen"
            value={fmt(perfData.panierMoyen)}
            icon={ShoppingCart}
            color="text-amber-600 bg-amber-50"
            trend={{ current: perfData.panierMoyen, previous: perfData.panierMoyenN1 }}
          />
          <KpiCard
            label="Tickets Jour"
            value={String(perfData.ticketsJour)}
            sub={`${perfData.ticketsSemaine} / semaine`}
            icon={Receipt}
            color="text-cyan-600 bg-cyan-50"
            trend={{ current: perfData.ticketsJour, previous: perfData.ticketsJourN1 }}
          />
          <KpiCard
            label="Taux Transformation"
            value={`${perfData.tauxTransformation}%`}
            icon={Target}
            color="text-pink-600 bg-pink-50"
            trend={{ current: perfData.tauxTransformation, previous: perfData.tauxTransformationN1 }}
          />
        </div>

        {/* ROW 2: Objectif + CA/m² + CA/employé + Pic horaire */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {/* Objectif Mensuel */}
          <div className="bg-gradient-to-br from-bo-sidebar via-slate-800 to-slate-900 rounded-2xl p-5 text-white col-span-2">
            <div className="flex items-center justify-between mb-3">
              <div>
                <p className="text-xs font-semibold text-white/50 uppercase tracking-wider">Objectif Mois</p>
                <p className="text-2xl font-black mt-1">
                  {fmtK(perfData.caMois)}
                  <span className="text-base text-white/40 ml-2">/ {fmtK(perfData.objectifMois)}</span>
                </p>
              </div>
              <div className={`text-3xl font-black ${objectifPct >= 100 ? 'text-emerald-400' : objectifPct >= 80 ? 'text-amber-400' : 'text-red-400'}`}>
                {objectifPct}%
              </div>
            </div>
            <div className="relative h-3 bg-white/10 rounded-full overflow-hidden mb-2">
              <div
                className={`h-full rounded-full transition-all duration-1000 ${objectifPct >= 100 ? 'bg-emerald-400' : objectifPct >= 80 ? 'bg-amber-400' : 'bg-red-400'}`}
                style={{ width: `${Math.min(objectifPct, 100)}%` }}
              />
            </div>
            <div className="flex justify-between text-[11px] text-white/40">
              <span>Reste {fmtK(Math.max(perfData.objectifMois - perfData.caMois, 0))} a realiser</span>
              <span>Projection : {fmtK(projectedWeekTotal * 4)}</span>
            </div>
          </div>

          <KpiCard
            label="CA / m²"
            value={fmt(caParM2)}
            sub={`Surface : ${perfData.surfaceM2} m²`}
            icon={Building2}
            color="text-teal-600 bg-teal-50"
          />
          <KpiCard
            label="CA / Employe"
            value={fmtK(caParEmploye)}
            sub={`${perfData.nbEmployes} employes actifs`}
            icon={Users}
            color="text-purple-600 bg-purple-50"
          />
        </div>

        {/* ROW 3: CA Horaire Chart + Semaine Chart */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* CA par heure */}
          <div className="bg-white rounded-2xl p-5 shadow-soft border border-gray-100/50">
            <div className="flex items-center justify-between mb-4">
              <h4 className="font-semibold text-bo-text flex items-center gap-2">
                <Clock size={14} className="text-[#E5117A]" />
                CA par heure — Pic : {peakHour.h}
              </h4>
              <span className="text-xs font-semibold text-[#E5117A] bg-indigo-50 px-2 py-0.5 rounded-full">
                {fmtK(peakHour.ca)}
              </span>
            </div>
            <div className="flex items-end gap-1.5 h-32">
              {perfData.hourlyCA.map((h) => {
                const pct = maxHourlyCA > 0 ? (h.ca / maxHourlyCA) * 100 : 0;
                const isPeak = h.ca === maxHourlyCA;
                return (
                  <div key={h.h} className="flex-1 flex flex-col items-center gap-1 group">
                    <span className={`text-[9px] font-semibold opacity-0 group-hover:opacity-100 transition-opacity ${isPeak ? 'opacity-100 text-[#E5117A]' : 'text-gray-400'}`}>
                      {fmtK(h.ca)}
                    </span>
                    <div className="w-full" style={{ height: '90px', display: 'flex', alignItems: 'flex-end' }}>
                      <div
                        className={`w-full rounded-t-md transition-all ${
                          isPeak
                            ? 'bg-gradient-to-t from-[#E5117A] to-indigo-400'
                            : pct >= 70
                            ? 'bg-gradient-to-t from-indigo-300 to-indigo-200 group-hover:from-[#E5117A]/60'
                            : 'bg-gradient-to-t from-indigo-200 to-indigo-100 group-hover:from-indigo-300'
                        }`}
                        style={{ height: `${pct}%`, minHeight: '4px' }}
                      />
                    </div>
                    <span className={`text-[9px] font-medium ${isPeak ? 'text-[#E5117A] font-bold' : 'text-gray-400'}`}>{h.h}</span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Semaine glissante */}
          <div className="bg-white rounded-2xl p-5 shadow-soft border border-gray-100/50">
            <div className="flex items-center justify-between mb-4">
              <h4 className="font-semibold text-bo-text flex items-center gap-2">
                <BarChart3 size={14} className="text-[#E5117A]" />
                Semaine en cours
              </h4>
              <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${weekProgressPct >= 100 ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>
                {weekProgressPct}% objectif
              </span>
            </div>
            <div className="flex items-end gap-2 h-32">
              {WEEK_DAYS.map((day, i) => {
                const avg = perfData.weekAvg[i];
                const actual = perfData.weekActual[i];
                const isFuture = i > dayIndex;
                const pct = avg > 0 ? (actual / avg) * 100 : 0;
                const maxVal = Math.max(...perfData.weekAvg, 1);
                return (
                  <div key={day} className="flex-1 flex flex-col items-center gap-1">
                    {!isFuture && actual > 0 && (
                      <span className={`text-[9px] font-bold ${pct >= 100 ? 'text-emerald-500' : 'text-amber-500'}`}>
                        {Math.round(pct)}%
                      </span>
                    )}
                    <div className="w-full flex gap-0.5" style={{ height: '90px', alignItems: 'flex-end' }}>
                      <div
                        className="flex-1 bg-gray-100 rounded-t"
                        style={{ height: `${(avg / maxVal) * 100}%`, minHeight: '4px' }}
                      />
                      {!isFuture && (
                        <div
                          className={`flex-1 rounded-t ${pct >= 100 ? 'bg-emerald-400' : 'bg-amber-400'}`}
                          style={{ height: `${(actual / maxVal) * 100}%`, minHeight: actual > 0 ? '4px' : '0px' }}
                        />
                      )}
                    </div>
                    <span className={`text-[9px] font-medium ${i === dayIndex ? 'text-bo-text font-bold' : 'text-gray-400'}`}>{day}</span>
                  </div>
                );
              })}
            </div>
            <div className="flex items-center gap-4 mt-2 text-[9px] text-gray-400">
              <span className="flex items-center gap-1"><span className="w-2 h-2 bg-gray-100 rounded" /> Moyenne N-1</span>
              <span className="flex items-center gap-1"><span className="w-2 h-2 bg-emerald-400 rounded" /> Realise</span>
            </div>
          </div>
        </div>

        {/* ROW 4: Monthly CA comparison (mini chart) */}
        <div className="bg-white rounded-2xl p-5 shadow-soft border border-gray-100/50">
          <h4 className="font-semibold text-bo-text flex items-center gap-2 mb-4">
            <Activity size={14} className="text-[#E5117A]" />
            Evolution CA mensuel — N vs N-1
          </h4>
          <div className="flex items-end gap-1 h-24">
            {MONTHS_SHORT.map((month, i) => {
              const current = perfData.monthlyCA[i];
              const prev = perfData.monthlyCAN1[i];
              const maxVal = Math.max(...perfData.monthlyCA, ...perfData.monthlyCAN1, 1);
              const isCurrentMonth = i === new Date().getMonth();
              return (
                <div key={month} className="flex-1 flex flex-col items-center gap-1 group">
                  <div className="w-full flex gap-px" style={{ height: '70px', alignItems: 'flex-end' }}>
                    <div
                      className="flex-1 bg-gray-200 rounded-t"
                      style={{ height: `${(prev / maxVal) * 100}%`, minHeight: '2px' }}
                    />
                    <div
                      className={`flex-1 rounded-t ${current > prev ? 'bg-emerald-400' : current > 0 ? 'bg-amber-400' : 'bg-gray-100'}`}
                      style={{ height: current > 0 ? `${(current / maxVal) * 100}%` : '0%', minHeight: current > 0 ? '2px' : '0px' }}
                    />
                  </div>
                  <span className={`text-[8px] font-medium ${isCurrentMonth ? 'text-[#E5117A] font-bold' : 'text-gray-400'}`}>{month}</span>
                </div>
              );
            })}
          </div>
          <div className="flex items-center gap-4 mt-2 text-[9px] text-gray-400">
            <span className="flex items-center gap-1"><span className="w-2 h-2 bg-gray-200 rounded" /> N-1</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 bg-emerald-400 rounded" /> Annee en cours</span>
          </div>
        </div>
      </section>

      {/* ╔═══════════════════════════════════════════════════════════╗
         ║  B. ANALYSE PRODUITS                                      ║
         ╚═══════════════════════════════════════════════════════════╝ */}
      <section className="space-y-4">
        <SectionHeader
          icon={Package}
          title="B. Analyse Produits"
          subtitle="Top/Flop, marges, stock, categories"
          color="bg-emerald-500"
        />

        {/* Product stats row */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          <KpiCard label="Marge brute" value={`${productStats.margeBruteGlobale}%`} icon={Percent} color="text-emerald-600 bg-emerald-50" trend={{ current: productStats.margeBruteGlobale, previous: productStats.margeBruteN1 }} />
          <KpiCard label="Rotation stock" value={`${productStats.rotationStock}x`} sub="/ mois" icon={RefreshCw} color="text-blue-600 bg-blue-50" />
          <KpiCard label="Ruptures" value={String(productStats.rupturesActuelles)} icon={AlertTriangle} color="text-red-600 bg-red-50" />
          <KpiCard label="Dormants" value={String(productStats.produitsDormants)} sub="> 10j sans vente" icon={Snowflake} color="text-gray-600 bg-gray-50" />
          <KpiCard label="References" value={String(productStats.nbReferences)} icon={Layers} color="text-violet-600 bg-violet-50" />
          <KpiCard label="Ventes / cat." value={`${productCategories.length} cat.`} icon={PieChart} color="text-pink-600 bg-pink-50" />
        </div>

        {/* Top / Flop toggle + table */}
        <div className="bg-white rounded-2xl p-5 shadow-soft border border-gray-100/50">
          <div className="flex items-center justify-between mb-4">
            <div className="flex bg-gray-100 rounded-xl p-1">
              <button
                onClick={() => setProductView('top')}
                className={`px-4 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5 ${
                  productView === 'top' ? 'bg-white shadow-soft text-emerald-600' : 'text-gray-400'
                }`}
              >
                <Flame size={12} /> Top 10
              </button>
              <button
                onClick={() => setProductView('flop')}
                className={`px-4 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5 ${
                  productView === 'flop' ? 'bg-white shadow-soft text-red-600' : 'text-gray-400'
                }`}
              >
                <TrendingDown size={12} /> Flop 5
              </button>
            </div>
            <span className="text-xs text-gray-400">Periode : mois en cours</span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[10px] uppercase tracking-wider text-gray-400 border-b border-gray-100">
                  <th className="text-left py-2 font-semibold">#</th>
                  <th className="text-left py-2 font-semibold">Produit</th>
                  <th className="text-left py-2 font-semibold">EAN</th>
                  <th className="text-right py-2 font-semibold">Qte</th>
                  <th className="text-right py-2 font-semibold">CA</th>
                  <th className="text-right py-2 font-semibold">Marge</th>
                  <th className="text-right py-2 font-semibold">Stock</th>
                  {productView === 'flop' && <th className="text-right py-2 font-semibold">Dern. vente</th>}
                </tr>
              </thead>
              <tbody>
                {(productView === 'top' ? topProducts : flopProducts).map((p) => (
                  <tr key={p.ean} className="border-b border-gray-50 hover:bg-gray-50/50 transition-colors">
                    <td className="py-2.5 font-mono text-xs text-gray-400">{p.rank}</td>
                    <td className="py-2.5 font-medium text-bo-text">{p.name}</td>
                    <td className="py-2.5 font-mono text-xs text-gray-400">{p.ean}</td>
                    <td className="py-2.5 text-right font-semibold">{p.qty}</td>
                    <td className="py-2.5 text-right font-semibold text-[#E5117A]">{fmtK(p.ca)}</td>
                    <td className="py-2.5 text-right">
                      <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                        p.marge >= 60 ? 'bg-emerald-50 text-emerald-700' :
                        p.marge >= 45 ? 'bg-amber-50 text-amber-700' :
                        'bg-red-50 text-red-700'
                      }`}>
                        {p.marge}%
                      </span>
                    </td>
                    <td className="py-2.5 text-right">
                      <span className={`text-xs font-semibold ${p.stock <= 10 ? 'text-red-600' : p.stock <= 20 ? 'text-amber-600' : 'text-gray-600'}`}>
                        {p.stock}
                      </span>
                    </td>
                    {productView === 'flop' && 'lastSale' in p && (
                      <td className="py-2.5 text-right text-xs text-gray-400">{(p as any).lastSale}</td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Categories + Ruptures + Dormants */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Ventes par catégorie */}
          <div className="bg-white rounded-2xl p-5 shadow-soft border border-gray-100/50">
            <h4 className="font-semibold text-bo-text mb-4 flex items-center gap-2">
              <PieChart size={14} className="text-emerald-500" />
              Ventes par categorie
            </h4>
            <div className="space-y-3">
              {productCategories.map((cat) => (
                <HBar
                  key={cat.name}
                  label={cat.name}
                  value={`${cat.pct}%`}
                  pct={cat.pct}
                  color="bg-gradient-to-r from-emerald-400 to-emerald-300"
                />
              ))}
            </div>
          </div>

          {/* Ruptures stock */}
          <div className="bg-white rounded-2xl p-5 shadow-soft border border-gray-100/50">
            <h4 className="font-semibold text-bo-text mb-4 flex items-center gap-2">
              <AlertTriangle size={14} className="text-red-500" />
              Alertes stock
              <span className="ml-auto text-xs bg-red-50 text-red-600 px-2 py-0.5 rounded-full font-semibold ring-1 ring-red-200">
                {stockAlerts.length}
              </span>
            </h4>
            <div className="space-y-2">
              {stockAlerts.length === 0 && (
                <p className="text-xs text-gray-400 text-center py-3">Aucune alerte stock</p>
              )}
              {stockAlerts.map((item) => {
                const levelStyle = item.level === 'out_of_stock'
                  ? 'text-red-700 bg-red-50 border-red-200'
                  : item.level === 'critical'
                  ? 'text-red-600 bg-red-50/50 border-red-100'
                  : 'text-amber-600 bg-amber-50/50 border-amber-100';
                const levelLabel = item.level === 'out_of_stock' ? 'Rupture' : item.level === 'critical' ? 'Critique' : 'Bas';
                return (
                  <div key={item.productId || item.name} className="flex items-center justify-between py-2 border-b border-gray-50 last:border-0">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-bo-text truncate">{item.name}</p>
                      <p className="text-[10px] text-gray-400">{item.ean}</p>
                    </div>
                    <div className="flex items-center gap-2 ml-2">
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${levelStyle}`}>
                        {levelLabel}
                      </span>
                      <span className={`text-xs font-bold ${item.level === 'out_of_stock' ? 'text-red-700' : item.level === 'critical' ? 'text-red-600' : 'text-amber-600'}`}>
                        {item.stock}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Produits dormants */}
          <div className="bg-white rounded-2xl p-5 shadow-soft border border-gray-100/50">
            <h4 className="font-semibold text-bo-text mb-4 flex items-center gap-2">
              <Snowflake size={14} className="text-blue-400" />
              Produits dormants
            </h4>
            <div className="space-y-2">
              {dormantProducts.map((item) => (
                <div key={item.name} className="flex items-center justify-between py-2 border-b border-gray-50 last:border-0">
                  <div>
                    <p className="text-sm font-medium text-bo-text">{item.name}</p>
                    <p className="text-[10px] text-gray-400">Derniere vente : {item.lastSale}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs font-semibold text-gray-600">{item.stock} en stock</p>
                    <p className="text-[10px] text-gray-400">Valeur : {fmtK(item.valeurStock)}</p>
                  </div>
                </div>
              ))}
              <div className="bg-amber-50 rounded-xl px-3 py-2 mt-2">
                <p className="text-[11px] text-amber-700 font-medium">
                  Valeur immobilisee : {fmtK(dormantProducts.reduce((s, d) => s + d.valeurStock, 0))}
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ╔═══════════════════════════════════════════════════════════╗
         ║  C. ANALYSE CAISSE & EQUIPE                               ║
         ╚═══════════════════════════════════════════════════════════╝ */}
      <section className="space-y-4">
        <SectionHeader
          icon={UserCheck}
          title="C. Analyse Caisse & Equipe"
          subtitle="Performance caissiers, vitesse, ecarts, rapport Z"
          color="bg-cyan-500"
        />

        {/* Caisse stats KPIs */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          <KpiCard label="Vitesse moy." value={`${caisseStats.vitesseMoyenne}s`} sub={`Min: ${caisseStats.vitesseMin}s — Max: ${caisseStats.vitesseMax}s`} icon={Timer} color="text-cyan-600 bg-cyan-50" />
          <KpiCard label="Tickets annules" value={String(caisseStats.ticketsAnnules)} icon={XCircle} color="text-red-600 bg-red-50" />
          <KpiCard label="Remboursements" value={fmt(caisseStats.totalRemboursements)} icon={RotateCcw} color="text-amber-600 bg-amber-50" />
          <KpiCard label="Ecart caisse" value={`${caisseStats.ecartCaisseTotal >= 0 ? '+' : ''}${fmt(caisseStats.ecartCaisseTotal)}`} icon={Scale} color={caisseStats.ecartCaisseTotal === 0 ? 'text-emerald-600 bg-emerald-50' : 'text-amber-600 bg-amber-50'} />
          <KpiCard label="Rapport Z" value={caisseStats.rapportZAuto ? 'Auto' : 'Manuel'} sub="Generation automatique" icon={FileText} color="text-violet-600 bg-violet-50" />
          <KpiCard label="Caissiers actifs" value={String(cashierData.length)} icon={Users} color="text-[#E5117A] bg-indigo-50" />
        </div>

        {/* Cashier performance table */}
        <div className="bg-white rounded-2xl p-5 shadow-soft border border-gray-100/50">
          <div className="flex items-center justify-between mb-4">
            <h4 className="font-semibold text-bo-text flex items-center gap-2">
              <Users size={14} className="text-cyan-500" />
              Performance par caissier
            </h4>
            <button
              onClick={() => setShowAllCashiers(!showAllCashiers)}
              className="text-xs text-[#E5117A] font-semibold hover:underline flex items-center gap-1"
            >
              {showAllCashiers ? 'Reduire' : 'Voir tout'}
              {showAllCashiers ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[10px] uppercase tracking-wider text-gray-400 border-b border-gray-100">
                  <th className="text-left py-2 font-semibold">Caissier</th>
                  <th className="text-right py-2 font-semibold">Tickets</th>
                  <th className="text-right py-2 font-semibold">CA</th>
                  <th className="text-right py-2 font-semibold">Vitesse moy.</th>
                  <th className="text-right py-2 font-semibold">Annulations</th>
                  <th className="text-right py-2 font-semibold">Remboursements</th>
                  <th className="text-right py-2 font-semibold">Ecart caisse</th>
                </tr>
              </thead>
              <tbody>
                {(showAllCashiers ? cashierData : cashierData.slice(0, 3)).map((c) => (
                  <tr key={c.name} className="border-b border-gray-50 hover:bg-gray-50/50 transition-colors">
                    <td className="py-2.5">
                      <div className="flex items-center gap-2">
                        <div className="w-7 h-7 rounded-full bg-gradient-to-br from-[#E5117A] to-indigo-400 flex items-center justify-center">
                          <span className="text-white text-[10px] font-bold">
                            {c.name.split(' ').map(n => n[0]).join('')}
                          </span>
                        </div>
                        <span className="font-medium text-bo-text">{c.name}</span>
                      </div>
                    </td>
                    <td className="py-2.5 text-right font-semibold">{c.tickets}</td>
                    <td className="py-2.5 text-right font-semibold text-[#E5117A]">{fmtK(c.ca)}</td>
                    <td className="py-2.5 text-right">
                      <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                        c.vitesseMoy <= 35 ? 'bg-emerald-50 text-emerald-700' :
                        c.vitesseMoy <= 45 ? 'bg-amber-50 text-amber-700' :
                        'bg-red-50 text-red-700'
                      }`}>
                        {c.vitesseMoy}s
                      </span>
                    </td>
                    <td className="py-2.5 text-right">
                      <span className={c.annulations > 0 ? 'text-red-600 font-semibold' : 'text-gray-400'}>{c.annulations}</span>
                    </td>
                    <td className="py-2.5 text-right">
                      <span className={c.remboursements > 0 ? 'text-amber-600 font-semibold' : 'text-gray-400'}>
                        {c.remboursements > 0 ? fmt(c.remboursements) : '—'}
                      </span>
                    </td>
                    <td className="py-2.5 text-right">
                      <span className={`font-semibold ${
                        c.ecart === 0 ? 'text-emerald-600' :
                        Math.abs(c.ecart) <= 50 ? 'text-amber-600' :
                        'text-red-600'
                      }`}>
                        {c.ecart === 0 ? '0,00 \u20ac' : `${c.ecart > 0 ? '+' : ''}${fmt(c.ecart)}`}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Rapport Z historique */}
        <div className="bg-white rounded-2xl p-5 shadow-soft border border-gray-100/50">
          <div className="flex items-center justify-between mb-4">
            <h4 className="font-semibold text-bo-text flex items-center gap-2">
              <FileText size={14} className="text-violet-500" />
              Historique Rapports Z
            </h4>
            <button
              onClick={() => setShowZHistory(!showZHistory)}
              className="text-xs text-[#E5117A] font-semibold hover:underline flex items-center gap-1"
            >
              {showZHistory ? 'Masquer' : 'Afficher'}
              {showZHistory ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
            </button>
          </div>
          {showZHistory && (
            <div className="overflow-x-auto animate-slide-up">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-[10px] uppercase tracking-wider text-gray-400 border-b border-gray-100">
                    <th className="text-left py-2 font-semibold">Date</th>
                    <th className="text-right py-2 font-semibold">CA Total</th>
                    <th className="text-right py-2 font-semibold">Tickets</th>
                    <th className="text-right py-2 font-semibold">Especes</th>
                    <th className="text-right py-2 font-semibold">CB</th>
                    <th className="text-right py-2 font-semibold">Mixte</th>
                    <th className="text-right py-2 font-semibold">Ecart</th>
                  </tr>
                </thead>
                <tbody>
                  {zReports.map((z) => (
                    <tr key={z.date} className="border-b border-gray-50 hover:bg-gray-50/50 transition-colors">
                      <td className="py-2.5 font-mono text-xs text-gray-600">{z.date}</td>
                      <td className="py-2.5 text-right font-bold text-bo-text">{fmt(z.caTotal)}</td>
                      <td className="py-2.5 text-right font-semibold">{z.tickets}</td>
                      <td className="py-2.5 text-right text-emerald-600">{fmt(z.especes)}</td>
                      <td className="py-2.5 text-right text-[#E5117A]">{fmt(z.cb)}</td>
                      <td className="py-2.5 text-right text-amber-600">{fmt(z.mixte)}</td>
                      <td className="py-2.5 text-right">
                        <span className={`font-semibold ${
                          z.ecart === 0 ? 'text-emerald-600' :
                          Math.abs(z.ecart) <= 50 ? 'text-amber-600' :
                          'text-red-600'
                        }`}>
                          {z.ecart === 0 ? '0,00 \u20ac' : `${z.ecart > 0 ? '+' : ''}${fmt(z.ecart)}`}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {!showZHistory && zReports.length > 0 && (
            <p className="text-xs text-gray-400">
              Dernier rapport Z : {zReports[0].date} — CA : {fmt(zReports[0].caTotal)} — Ecart : {zReports[0].ecart === 0 ? '0' : `${zReports[0].ecart > 0 ? '+' : ''}${fmt(zReports[0].ecart)}`}
            </p>
          )}
        </div>
      </section>

      {/* ╔═══════════════════════════════════════════════════════════╗
         ║  D. PAIEMENTS                                             ║
         ╚═══════════════════════════════════════════════════════════╝ */}
      <section className="space-y-4">
        <SectionHeader
          icon={CreditCard}
          title="D. Paiements"
          subtitle="Repartition, fractionne, refus, taxes"
          color="bg-amber-500"
        />

        {/* Payment mode distribution */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Répartition */}
          <div className="bg-white rounded-2xl p-5 shadow-soft border border-gray-100/50 lg:col-span-2">
            <h4 className="font-semibold text-bo-text mb-4 flex items-center gap-2">
              <PieChart size={14} className="text-amber-500" />
              Repartition des modes de paiement
            </h4>
            <div className="space-y-4">
              <HBar label={`Carte bancaire (${paymentData.cb.count} tx)`} value={`${paymentData.cb.pct}% — ${fmtK(paymentData.cb.montant)}`} pct={paymentData.cb.pct} color="bg-gradient-to-r from-[#E5117A] to-indigo-400" />
              <HBar label={`Especes (${paymentData.especes.count} tx)`} value={`${paymentData.especes.pct}% — ${fmtK(paymentData.especes.montant)}`} pct={paymentData.especes.pct} color="bg-gradient-to-r from-emerald-400 to-emerald-300" />
              <HBar label={`Mixte / Fractionne (${paymentData.mixte.count} tx)`} value={`${paymentData.mixte.pct}% — ${fmtK(paymentData.mixte.montant)}`} pct={paymentData.mixte.pct} color="bg-gradient-to-r from-amber-400 to-amber-300" />
            </div>

            {/* Visual bar */}
            <div className="mt-4 flex h-4 rounded-full overflow-hidden">
              <div className="bg-[#E5117A]" style={{ width: `${paymentData.cb.pct}%` }} />
              <div className="bg-emerald-400" style={{ width: `${paymentData.especes.pct}%` }} />
              <div className="bg-amber-400" style={{ width: `${paymentData.mixte.pct}%` }} />
            </div>
            <div className="flex items-center gap-4 mt-2 text-[10px] text-gray-400">
              <span className="flex items-center gap-1"><span className="w-2 h-2 bg-[#E5117A] rounded" /> CB</span>
              <span className="flex items-center gap-1"><span className="w-2 h-2 bg-emerald-400 rounded" /> Especes</span>
              <span className="flex items-center gap-1"><span className="w-2 h-2 bg-amber-400 rounded" /> Mixte</span>
            </div>
          </div>

          {/* Right column: alerts + stats */}
          <div className="space-y-4">
            {/* CB refusés */}
            <div className="bg-white rounded-2xl p-4 shadow-soft border border-gray-100/50">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl bg-red-50 flex items-center justify-center">
                    <Ban size={16} className="text-red-500" />
                  </div>
                  <div>
                    <p className="text-lg font-black text-red-600">{paymentData.cbRefuses}</p>
                    <p className="text-[11px] text-gray-400">CB refuses</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl bg-violet-50 flex items-center justify-center">
                    <Gift size={16} className="text-violet-500" />
                  </div>
                  <div>
                    <p className="text-lg font-black text-violet-600">{paymentData.ticketsOfferts}</p>
                    <p className="text-[11px] text-gray-400">Offerts ({fmt(paymentData.montantOffert)})</p>
                  </div>
                </div>
              </div>
            </div>

            {/* Réductions */}
            <div className="bg-white rounded-2xl p-4 shadow-soft border border-gray-100/50">
              <div className="flex items-center gap-3 mb-2">
                <div className="w-9 h-9 rounded-xl bg-amber-50 flex items-center justify-center">
                  <Percent size={16} className="text-amber-500" />
                </div>
                <div>
                  <p className="text-lg font-black text-bo-text">{fmt(paymentData.reductionsTotales)}</p>
                  <p className="text-[11px] text-gray-400">Reductions totales ({paymentData.pctReductions}% du CA)</p>
                </div>
              </div>
            </div>

            {/* Taxes */}
            <div className="bg-white rounded-2xl p-4 shadow-soft border border-gray-100/50">
              <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3 flex items-center gap-2">
                <Calculator size={12} />
                TVA collectee
              </h4>
              <p className="text-lg font-black text-bo-text mb-3">{fmt(paymentData.tvaCollectee)}</p>
              <div className="space-y-1.5 text-xs">
                <div className="flex justify-between">
                  <span className="text-gray-500">TVA 20%</span>
                  <span className="font-semibold">{fmt(paymentData.tva20)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">TVA 10%</span>
                  <span className="font-semibold">{fmt(paymentData.tva10)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">TVA 5,5%</span>
                  <span className="font-semibold">{fmt(paymentData.tva55)}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>



      {/* ══════════ FOOTER ══════════ */}
      <div className="flex items-center justify-between py-4 border-t border-gray-100 text-[10px] text-gray-300">
        <span>Dashboard CEO — Actualise en temps reel</span>
        <span>CAISSE v1.0.0 — NF525</span>
      </div>
    </div>
  );
}
