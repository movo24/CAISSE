import React, { useState, useMemo } from 'react';
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
  return (
    <div className="bg-white rounded-2xl p-4 shadow-soft border border-gray-100/50 hover:shadow-card transition-shadow">
      <div className="flex items-start justify-between mb-2">
        <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${color}`}>
          <Icon size={16} />
        </div>
        {trend && <VariationBadge current={trend.current} previous={trend.previous} />}
      </div>
      <p className="text-xl font-black text-bo-text mt-1">{value}</p>
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

  /* ══════════ F. CASH CONTROL — Computed Risk Scores ══════════ */
  const cashControlAnalysis = useMemo(() => {
    const tauxList = cashierCashControl.map((c) => c.tauxEspeces);
    const n = tauxList.length;
    const moyenne = tauxList.reduce((s, v) => s + v, 0) / n;
    const variance = tauxList.reduce((s, v) => s + Math.pow(v - moyenne, 2), 0) / n;
    const ecartType = Math.sqrt(variance);

    // Seuil anomalie : > 2 écarts-types au-dessus OU > X% au-dessus de la moyenne
    const seuilHaut = moyenne + 2 * ecartType;
    const seuilBas = moyenne - 2 * ecartType;
    const seuilPctDeviation = 20; // % deviation seuil

    const scored = cashierCashControl.map((c) => {
      let riskScore = 0;
      const factors: string[] = [];

      // 1. Anomalie taux espèces (0-30 pts)
      const ecartPct = ((c.tauxEspeces - moyenne) / moyenne) * 100;
      if (c.tauxEspeces > seuilHaut) {
        riskScore += 30;
        factors.push(`Taux especes ${c.tauxEspeces.toFixed(1)}% > seuil 2σ (${seuilHaut.toFixed(1)}%)`);
      } else if (Math.abs(ecartPct) > seuilPctDeviation) {
        riskScore += 20;
        factors.push(`Ecart ${ecartPct > 0 ? '+' : ''}${ecartPct.toFixed(1)}% vs moyenne`);
      } else if (Math.abs(ecartPct) > 10) {
        riskScore += 10;
        factors.push(`Deviation moderee ${ecartPct > 0 ? '+' : ''}${ecartPct.toFixed(1)}%`);
      }

      // 2. Volume d'annulations (0-15 pts)
      if (c.annulations >= 3) { riskScore += 15; factors.push(`${c.annulations} annulations`); }
      else if (c.annulations >= 1) { riskScore += 5; factors.push(`${c.annulations} annulation(s)`); }

      // 3. Tickets supprimés (0-15 pts) — très suspect
      if (c.ticketsSupprimes >= 2) { riskScore += 15; factors.push(`${c.ticketsSupprimes} tickets supprimes`); }
      else if (c.ticketsSupprimes >= 1) { riskScore += 10; factors.push(`${c.ticketsSupprimes} ticket supprime`); }

      // 4. Écarts de caisse (0-15 pts)
      const absEcart = Math.abs(c.ecartCaisse);
      if (absEcart > 100) { riskScore += 15; factors.push(`Ecart caisse ${c.ecartCaisse > 0 ? '+' : ''}${(c.ecartCaisse / 100).toFixed(2)}€`); }
      else if (absEcart > 50) { riskScore += 8; factors.push(`Ecart caisse ${c.ecartCaisse > 0 ? '+' : ''}${(c.ecartCaisse / 100).toFixed(2)}€`); }
      else if (absEcart > 0) { riskScore += 3; }

      // 5. Tendance 7j anormale (0-15 pts) — hausse continue suspecte
      const trend7 = c.tendance7j;
      let consecutiveUp = 0;
      for (let i = 1; i < trend7.length; i++) {
        if (trend7[i] > trend7[i - 1]) consecutiveUp++;
      }
      const trendDelta = trend7[trend7.length - 1] - trend7[0];
      if (consecutiveUp >= 5 && trendDelta > 5) {
        riskScore += 15;
        factors.push(`Tendance haussiere 7j (+${trendDelta.toFixed(1)}pts, ${consecutiveUp} jours consecutifs)`);
      } else if (consecutiveUp >= 3 && trendDelta > 3) {
        riskScore += 8;
        factors.push(`Tendance haussiere moderee`);
      }

      // 6. Remboursements élevés (0-5 pts)
      if (c.remboursements > 3000) { riskScore += 5; factors.push(`Remboursements: ${(c.remboursements / 100).toFixed(2)}€`); }
      else if (c.remboursements > 1000) { riskScore += 2; }

      // 7. Heures creuses exclusives (0-5 pts) — facteur contextuel
      if (c.heuresCreuses) { riskScore += 5; factors.push(`Activite en heures creuses`); }

      // Cap à 100
      riskScore = Math.min(riskScore, 100);

      // Niveau de risque
      const level: 'normal' | 'surveillance' | 'risque' =
        riskScore >= 60 ? 'risque' :
        riskScore >= 30 ? 'surveillance' :
        'normal';

      return {
        ...c,
        ecartPct,
        riskScore,
        level,
        factors,
        ecartSigma: (c.tauxEspeces - moyenne) / (ecartType || 1),
      };
    });

    // Tri par risque décroissant
    scored.sort((a, b) => b.riskScore - a.riskScore);

    const alertCount = scored.filter((s) => s.level === 'risque').length;
    const surveillanceCount = scored.filter((s) => s.level === 'surveillance').length;

    return { scored, moyenne, ecartType, seuilHaut, seuilBas, alertCount, surveillanceCount };
  }, []);

  // Computed values
  const caParM2 = perfData.caMois / perfData.surfaceM2;
  const caParEmploye = perfData.caMois / perfData.nbEmployes;
  const objectifPct = Math.round((perfData.caMois / perfData.objectifMois) * 100);

  // Find peak hour
  const peakHour = perfData.hourlyCA.length > 0
    ? perfData.hourlyCA.reduce((max, h) => h.ca > max.ca ? h : max, perfData.hourlyCA[0])
    : { h: '0', ca: 0 };
  const maxHourlyCA = peakHour.ca;

  // Current week progress
  const currentWeekTotal = perfData.weekActual.reduce((s, v) => s + v, 0);
  const weekProgressPct = Math.round((currentWeekTotal / perfData.weeklyObjective) * 100);
  const avgDailyRealized = currentWeekTotal / (dayIndex + 1);
  const projectedWeekTotal = Math.round(avgDailyRealized * 7);

  return (
    <div className="p-6 lg:p-8 space-y-6 animate-fade-in max-w-[1600px] mx-auto">
      {/* ══════════ HEADER ══════════ */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h2 className="text-2xl font-bold text-bo-text">Dashboard CEO</h2>
          <p className="text-gray-400 text-sm mt-1">Pilotage temps reel — Reseau multi-magasins</p>
        </div>
        <div className="flex items-center gap-3">
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
            className="text-xs font-semibold bg-white border border-gray-200 rounded-xl px-3 py-2 text-bo-text focus:ring-2 focus:ring-bo-accent/20 focus:border-bo-accent"
          >
            <option value="all">Tous les magasins</option>
            {stores.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
          {/* Export */}
          <button className="flex items-center gap-2 px-3 py-2 rounded-xl bg-white border border-gray-200 text-xs font-semibold text-gray-600 hover:border-bo-accent hover:text-bo-accent transition-all">
            <Download size={14} />
            Export
          </button>
        </div>
      </div>

      {/* ╔═══════════════════════════════════════════════════════════╗
         ║  A. PERFORMANCE COMMERCIALE                               ║
         ╚═══════════════════════════════════════════════════════════╝ */}
      <section className="space-y-4">
        <SectionHeader
          icon={TrendingUp}
          title="A. Performance Commerciale"
          subtitle="CA, objectifs, KPIs de vente en temps reel"
          color="bg-bo-accent"
        />

        {/* TOP KPIs ROW */}
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
          <KpiCard
            label="CA Jour"
            value={fmtK(perfData.caJour)}
            icon={Euro}
            color="text-bo-accent bg-indigo-50"
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
                <Clock size={14} className="text-bo-accent" />
                CA par heure — Pic : {peakHour.h}
              </h4>
              <span className="text-xs font-semibold text-bo-accent bg-indigo-50 px-2 py-0.5 rounded-full">
                {fmtK(peakHour.ca)}
              </span>
            </div>
            <div className="flex items-end gap-1.5 h-32">
              {perfData.hourlyCA.map((h) => {
                const pct = (h.ca / maxHourlyCA) * 100;
                const isPeak = h.ca === maxHourlyCA;
                return (
                  <div key={h.h} className="flex-1 flex flex-col items-center gap-1 group">
                    <span className={`text-[9px] font-semibold opacity-0 group-hover:opacity-100 transition-opacity ${isPeak ? 'opacity-100 text-bo-accent' : 'text-gray-400'}`}>
                      {fmtK(h.ca)}
                    </span>
                    <div className="w-full" style={{ height: '90px', display: 'flex', alignItems: 'flex-end' }}>
                      <div
                        className={`w-full rounded-t-md transition-all ${
                          isPeak
                            ? 'bg-gradient-to-t from-bo-accent to-indigo-400'
                            : pct >= 70
                            ? 'bg-gradient-to-t from-indigo-300 to-indigo-200 group-hover:from-bo-accent/60'
                            : 'bg-gradient-to-t from-indigo-200 to-indigo-100 group-hover:from-indigo-300'
                        }`}
                        style={{ height: `${pct}%`, minHeight: '4px' }}
                      />
                    </div>
                    <span className={`text-[9px] font-medium ${isPeak ? 'text-bo-accent font-bold' : 'text-gray-400'}`}>{h.h}</span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Semaine glissante */}
          <div className="bg-white rounded-2xl p-5 shadow-soft border border-gray-100/50">
            <div className="flex items-center justify-between mb-4">
              <h4 className="font-semibold text-bo-text flex items-center gap-2">
                <BarChart3 size={14} className="text-bo-accent" />
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
                const maxVal = Math.max(...perfData.weekAvg);
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
            <Activity size={14} className="text-bo-accent" />
            Evolution CA mensuel — N vs N-1
          </h4>
          <div className="flex items-end gap-1 h-24">
            {MONTHS_SHORT.map((month, i) => {
              const current = perfData.monthlyCA[i];
              const prev = perfData.monthlyCAN1[i];
              const maxVal = Math.max(...perfData.monthlyCA, ...perfData.monthlyCAN1);
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
                  <span className={`text-[8px] font-medium ${isCurrentMonth ? 'text-bo-accent font-bold' : 'text-gray-400'}`}>{month}</span>
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
                    <td className="py-2.5 text-right font-semibold text-bo-accent">{fmtK(p.ca)}</td>
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
          <KpiCard label="Caissiers actifs" value={String(cashierData.length)} icon={Users} color="text-bo-accent bg-indigo-50" />
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
              className="text-xs text-bo-accent font-semibold hover:underline flex items-center gap-1"
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
                        <div className="w-7 h-7 rounded-full bg-gradient-to-br from-bo-accent to-indigo-400 flex items-center justify-center">
                          <span className="text-white text-[10px] font-bold">
                            {c.name.split(' ').map(n => n[0]).join('')}
                          </span>
                        </div>
                        <span className="font-medium text-bo-text">{c.name}</span>
                      </div>
                    </td>
                    <td className="py-2.5 text-right font-semibold">{c.tickets}</td>
                    <td className="py-2.5 text-right font-semibold text-bo-accent">{fmtK(c.ca)}</td>
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
              className="text-xs text-bo-accent font-semibold hover:underline flex items-center gap-1"
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
                      <td className="py-2.5 text-right text-bo-accent">{fmt(z.cb)}</td>
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
          {!showZHistory && (
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
              <HBar label={`Carte bancaire (${paymentData.cb.count} tx)`} value={`${paymentData.cb.pct}% — ${fmtK(paymentData.cb.montant)}`} pct={paymentData.cb.pct} color="bg-gradient-to-r from-bo-accent to-indigo-400" />
              <HBar label={`Especes (${paymentData.especes.count} tx)`} value={`${paymentData.especes.pct}% — ${fmtK(paymentData.especes.montant)}`} pct={paymentData.especes.pct} color="bg-gradient-to-r from-emerald-400 to-emerald-300" />
              <HBar label={`Mixte / Fractionne (${paymentData.mixte.count} tx)`} value={`${paymentData.mixte.pct}% — ${fmtK(paymentData.mixte.montant)}`} pct={paymentData.mixte.pct} color="bg-gradient-to-r from-amber-400 to-amber-300" />
            </div>

            {/* Visual bar */}
            <div className="mt-4 flex h-4 rounded-full overflow-hidden">
              <div className="bg-bo-accent" style={{ width: `${paymentData.cb.pct}%` }} />
              <div className="bg-emerald-400" style={{ width: `${paymentData.especes.pct}%` }} />
              <div className="bg-amber-400" style={{ width: `${paymentData.mixte.pct}%` }} />
            </div>
            <div className="flex items-center gap-4 mt-2 text-[10px] text-gray-400">
              <span className="flex items-center gap-1"><span className="w-2 h-2 bg-bo-accent rounded" /> CB</span>
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

      {/* ╔═══════════════════════════════════════════════════════════╗
         ║  F. CONTROLE INTERNE ESPECES — ANTI-DETOURNEMENT          ║
         ╚═══════════════════════════════════════════════════════════╝ */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <SectionHeader
            icon={ShieldAlert}
            title="F. Controle Interne Especes"
            subtitle="Detection d'anomalies, Risk Score, analyse croisee anti-detournement"
            color="bg-gradient-to-br from-red-600 to-rose-500"
          />
          {cashControlAnalysis.alertCount > 0 && (
            <span className="flex items-center gap-1.5 px-3 py-1.5 bg-red-50 text-red-700 text-xs font-bold rounded-full ring-1 ring-red-200 animate-pulse">
              <AlertOctagon size={12} />
              {cashControlAnalysis.alertCount} alerte(s) active(s)
            </span>
          )}
        </div>

        {/* KPIs Globaux */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          <KpiCard
            label="Taux especes magasin"
            value={`${cashControlAnalysis.moyenne.toFixed(1)}%`}
            sub="Moyenne globale"
            icon={Banknote}
            color="text-emerald-600 bg-emerald-50"
          />
          <KpiCard
            label="Ecart-type (σ)"
            value={`${cashControlAnalysis.ecartType.toFixed(1)}%`}
            sub="Dispersion statistique"
            icon={BarChart2}
            color="text-blue-600 bg-blue-50"
          />
          <KpiCard
            label="Seuil alerte (2σ)"
            value={`${cashControlAnalysis.seuilHaut.toFixed(1)}%`}
            sub={`Seuil bas: ${cashControlAnalysis.seuilBas.toFixed(1)}%`}
            icon={Target}
            color="text-amber-600 bg-amber-50"
          />
          <KpiCard
            label="Alertes actives"
            value={String(cashControlAnalysis.alertCount)}
            icon={AlertOctagon}
            color={cashControlAnalysis.alertCount > 0 ? 'text-red-600 bg-red-50' : 'text-emerald-600 bg-emerald-50'}
          />
          <KpiCard
            label="Sous surveillance"
            value={String(cashControlAnalysis.surveillanceCount)}
            icon={ScanEye}
            color={cashControlAnalysis.surveillanceCount > 0 ? 'text-amber-600 bg-amber-50' : 'text-emerald-600 bg-emerald-50'}
          />
          <KpiCard
            label="Caissiers controles"
            value={String(cashierCashControl.length)}
            sub="100% de l'equipe"
            icon={Fingerprint}
            color="text-violet-600 bg-violet-50"
          />
        </div>

        {/* TABLEAU RISK SCORE PAR CAISSIER */}
        <div className="bg-white rounded-2xl p-5 shadow-soft border border-gray-100/50">
          <h4 className="font-semibold text-bo-text mb-4 flex items-center gap-2">
            <Fingerprint size={14} className="text-red-500" />
            Risk Score par caissier
            <span className="ml-auto text-[10px] text-gray-400 font-normal">
              Score 0-100 | Multi-facteurs | Analyse croisee
            </span>
          </h4>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[10px] uppercase tracking-wider text-gray-400 border-b border-gray-100">
                  <th className="text-left py-2 font-semibold">Caissier</th>
                  <th className="text-center py-2 font-semibold">Risk Score</th>
                  <th className="text-center py-2 font-semibold">Statut</th>
                  <th className="text-right py-2 font-semibold">Taux especes</th>
                  <th className="text-right py-2 font-semibold">Ecart moy.</th>
                  <th className="text-right py-2 font-semibold">Sigma (σ)</th>
                  <th className="text-right py-2 font-semibold">Annul.</th>
                  <th className="text-right py-2 font-semibold">Ecart caisse</th>
                  <th className="text-right py-2 font-semibold">Tendance 7j</th>
                </tr>
              </thead>
              <tbody>
                {cashControlAnalysis.scored.map((c) => {
                  const trend = c.tendance7j;
                  const trendDelta = trend[trend.length - 1] - trend[0];
                  return (
                    <tr key={c.name} className={`border-b border-gray-50 transition-colors ${
                      c.level === 'risque' ? 'bg-red-50/30 hover:bg-red-50/60' :
                      c.level === 'surveillance' ? 'bg-amber-50/20 hover:bg-amber-50/40' :
                      'hover:bg-gray-50/50'
                    }`}>
                      <td className="py-3">
                        <div className="flex items-center gap-2">
                          <div className={`w-7 h-7 rounded-full flex items-center justify-center ${
                            c.level === 'risque' ? 'bg-gradient-to-br from-red-500 to-rose-400' :
                            c.level === 'surveillance' ? 'bg-gradient-to-br from-amber-500 to-orange-400' :
                            'bg-gradient-to-br from-emerald-500 to-green-400'
                          }`}>
                            <span className="text-white text-[10px] font-bold">
                              {c.name.split(' ').map((n: string) => n[0]).join('')}
                            </span>
                          </div>
                          <div>
                            <span className="font-medium text-bo-text">{c.name}</span>
                            {c.heuresCreuses && (
                              <span className="ml-1.5 text-[9px] text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded">
                                Heures creuses
                              </span>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="py-3 text-center">
                        <div className="flex items-center justify-center gap-2">
                          <div className="w-16 h-2 bg-gray-100 rounded-full overflow-hidden">
                            <div
                              className={`h-full rounded-full transition-all ${
                                c.riskScore >= 60 ? 'bg-red-500' :
                                c.riskScore >= 30 ? 'bg-amber-500' :
                                'bg-emerald-500'
                              }`}
                              style={{ width: `${c.riskScore}%` }}
                            />
                          </div>
                          <span className={`text-xs font-black ${
                            c.riskScore >= 60 ? 'text-red-600' :
                            c.riskScore >= 30 ? 'text-amber-600' :
                            'text-emerald-600'
                          }`}>
                            {c.riskScore}
                          </span>
                        </div>
                      </td>
                      <td className="py-3 text-center">
                        <span className={`inline-flex items-center gap-1 text-[10px] font-bold px-2.5 py-1 rounded-full ${
                          c.level === 'risque' ? 'bg-red-100 text-red-700 ring-1 ring-red-200' :
                          c.level === 'surveillance' ? 'bg-amber-100 text-amber-700 ring-1 ring-amber-200' :
                          'bg-emerald-100 text-emerald-700 ring-1 ring-emerald-200'
                        }`}>
                          <CircleDot size={8} />
                          {c.level === 'risque' ? 'RISQUE' : c.level === 'surveillance' ? 'SURVEILLANCE' : 'NORMAL'}
                        </span>
                      </td>
                      <td className="py-3 text-right">
                        <span className={`font-bold ${
                          c.tauxEspeces > cashControlAnalysis.seuilHaut ? 'text-red-600' :
                          Math.abs(c.ecartPct) > 10 ? 'text-amber-600' :
                          'text-gray-700'
                        }`}>
                          {c.tauxEspeces.toFixed(1)}%
                        </span>
                      </td>
                      <td className="py-3 text-right">
                        <span className={`text-xs font-semibold ${
                          c.ecartPct > 20 ? 'text-red-600' :
                          c.ecartPct > 10 ? 'text-amber-600' :
                          c.ecartPct < -10 ? 'text-blue-600' :
                          'text-gray-500'
                        }`}>
                          {c.ecartPct > 0 ? '+' : ''}{c.ecartPct.toFixed(1)}%
                        </span>
                      </td>
                      <td className="py-3 text-right">
                        <span className={`text-xs font-semibold ${
                          Math.abs(c.ecartSigma) > 2 ? 'text-red-600' :
                          Math.abs(c.ecartSigma) > 1 ? 'text-amber-600' :
                          'text-gray-500'
                        }`}>
                          {c.ecartSigma > 0 ? '+' : ''}{c.ecartSigma.toFixed(2)}σ
                        </span>
                      </td>
                      <td className="py-3 text-right">
                        <span className={c.annulations > 0 ? 'text-red-600 font-semibold' : 'text-gray-400'}>
                          {c.annulations}
                        </span>
                        {c.ticketsSupprimes > 0 && (
                          <span className="ml-1 text-[9px] bg-red-100 text-red-700 px-1 rounded">
                            +{c.ticketsSupprimes} suppr.
                          </span>
                        )}
                      </td>
                      <td className="py-3 text-right">
                        <span className={`font-semibold ${
                          Math.abs(c.ecartCaisse) > 100 ? 'text-red-600' :
                          Math.abs(c.ecartCaisse) > 50 ? 'text-amber-600' :
                          c.ecartCaisse === 0 ? 'text-emerald-600' :
                          'text-gray-500'
                        }`}>
                          {c.ecartCaisse === 0 ? '0' : `${c.ecartCaisse > 0 ? '+' : ''}${(c.ecartCaisse / 100).toFixed(2)}€`}
                        </span>
                      </td>
                      <td className="py-3 text-right">
                        {/* Mini sparkline */}
                        <div className="flex items-center gap-1 justify-end">
                          <div className="flex items-end gap-px h-4">
                            {trend.map((v, i) => (
                              <div
                                key={i}
                                className={`w-1 rounded-t ${
                                  v > cashControlAnalysis.seuilHaut ? 'bg-red-400' :
                                  v > cashControlAnalysis.moyenne + cashControlAnalysis.ecartType ? 'bg-amber-400' :
                                  'bg-emerald-400'
                                }`}
                                style={{ height: `${Math.max(((v - 20) / 30) * 100, 10)}%` }}
                              />
                            ))}
                          </div>
                          <span className={`text-[9px] font-bold ${
                            trendDelta > 3 ? 'text-red-600' : trendDelta > 1 ? 'text-amber-600' : 'text-emerald-600'
                          }`}>
                            {trendDelta > 0 ? '+' : ''}{trendDelta.toFixed(1)}
                          </span>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* FACTEURS DE RISQUE DETAILLÉS (pour les alertes) */}
        {cashControlAnalysis.scored.filter((c) => c.level !== 'normal').length > 0 && (
          <div className="bg-gradient-to-br from-red-50 via-white to-amber-50 rounded-2xl p-5 shadow-soft border border-red-100/50">
            <h4 className="font-semibold text-bo-text mb-4 flex items-center gap-2">
              <AlertCircle size={14} className="text-red-500" />
              Detail des facteurs de risque
            </h4>
            <div className="space-y-4">
              {cashControlAnalysis.scored.filter((c) => c.level !== 'normal').map((c) => (
                <div key={c.name} className={`rounded-xl p-4 border ${
                  c.level === 'risque' ? 'bg-red-50/50 border-red-200' : 'bg-amber-50/50 border-amber-200'
                }`}>
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <span className={`text-xs font-black px-2 py-0.5 rounded ${
                        c.level === 'risque' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'
                      }`}>
                        SCORE {c.riskScore}/100
                      </span>
                      <span className="font-semibold text-bo-text">{c.name}</span>
                    </div>
                    <span className="text-xs text-gray-400">{c.magasin}</span>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                    {c.factors.map((f, i) => (
                      <div key={i} className="flex items-start gap-2 text-xs">
                        <ChevronRight size={10} className={`mt-0.5 flex-shrink-0 ${
                          c.level === 'risque' ? 'text-red-500' : 'text-amber-500'
                        }`} />
                        <span className="text-gray-700">{f}</span>
                      </div>
                    ))}
                  </div>
                  {/* Contexte d'analyse croisée */}
                  <div className="mt-3 flex items-center gap-3 text-[10px] text-gray-400">
                    <span>CA: {fmtK(c.totalCA)}</span>
                    <span>|</span>
                    <span>Especes: {fmtK(c.especesCA)}</span>
                    <span>|</span>
                    <span>Vitesse: {c.vitesseMoy}s/tx</span>
                    <span>|</span>
                    <span>Rembours.: {c.remboursements > 0 ? fmt(c.remboursements) : '0'}</span>
                    <span>|</span>
                    <span>{c.tickets} tickets</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ROW: Comparaison Inter-magasins + IA Comportementale + Historique */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Comparaison inter-magasins */}
          <div className="bg-white rounded-2xl p-5 shadow-soft border border-gray-100/50">
            <h4 className="font-semibold text-bo-text mb-4 flex items-center gap-2">
              <Building2 size={14} className="text-bo-accent" />
              Comparaison reseau
            </h4>
            <div className="space-y-3">
              {interStoreComparison.map((store) => (
                <div key={store.magasin} className="flex items-center justify-between py-2 border-b border-gray-50 last:border-0">
                  <div>
                    <p className="text-sm font-medium text-bo-text">{store.magasin}</p>
                    <p className="text-[10px] text-gray-400">
                      Ecart moy: {store.ecartMoyen > 0 ? '+' : ''}{(store.ecartMoyen / 100).toFixed(2)}€ | Annul: {store.annulationsPct}%
                    </p>
                  </div>
                  <div className="text-right">
                    <span className={`text-sm font-bold ${
                      store.tauxEspeces > 36 ? 'text-amber-600' : 'text-emerald-600'
                    }`}>
                      {store.tauxEspeces}%
                    </span>
                    <p className="text-[9px] text-gray-400">especes</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* IA Comportementale — Insights */}
          <div className="bg-gradient-to-br from-indigo-50 via-white to-violet-50 rounded-2xl p-5 shadow-soft border border-indigo-100">
            <h4 className="font-semibold text-bo-text mb-4 flex items-center gap-2">
              <Brain size={14} className="text-bo-accent" />
              IA Comportementale
            </h4>
            <div className="space-y-3">
              {cashControlAnalysis.scored.filter((c) => c.level === 'risque').length > 0 && (
                <div className="bg-red-50 rounded-xl px-3 py-2.5 border border-red-200">
                  <p className="text-xs font-semibold text-red-700 mb-1">Schema detecte</p>
                  <p className="text-[11px] text-red-600 leading-relaxed">
                    {(() => {
                      const risky = cashControlAnalysis.scored.find((c) => c.level === 'risque');
                      if (!risky) return '';
                      return `${risky.name}: tendance haussiere constante du taux especes sur 7 jours (+${(risky.tendance7j[6] - risky.tendance7j[0]).toFixed(1)}pts), combinee avec ${risky.annulations} annulation(s), ${risky.ticketsSupprimes} ticket(s) supprime(s) et un ecart caisse de ${risky.ecartCaisse > 0 ? '+' : ''}${(risky.ecartCaisse / 100).toFixed(2)}€. Activite concentree en heures creuses.`;
                    })()}
                  </p>
                </div>
              )}
              <div className="bg-white rounded-xl px-3 py-2.5 border border-gray-100">
                <p className="text-xs font-semibold text-gray-500 mb-1">Analyse 30 jours</p>
                <p className="text-[11px] text-gray-600 leading-relaxed">
                  Moyenne magasin stable a {cashControlAnalysis.moyenne.toFixed(1)}%. Ecart-type de {cashControlAnalysis.ecartType.toFixed(1)}% — dispersion {'>'} 5% = heterogeneite a investiguer.
                </p>
              </div>
              <div className="bg-white rounded-xl px-3 py-2.5 border border-gray-100">
                <p className="text-xs font-semibold text-gray-500 mb-1">Facteurs contextualises</p>
                <p className="text-[11px] text-gray-600 leading-relaxed">
                  Attention : un taux especes different peut s'expliquer par le profil clientele, les horaires, la localisation ou la periode du mois. Toujours correler avant action.
                </p>
              </div>
            </div>
          </div>

          {/* Historique alertes */}
          <div className="bg-white rounded-2xl p-5 shadow-soft border border-gray-100/50">
            <div className="flex items-center justify-between mb-4">
              <h4 className="font-semibold text-bo-text flex items-center gap-2">
                <History size={14} className="text-gray-500" />
                Historique alertes
              </h4>
              <button
                onClick={() => setShowAlertHistory(!showAlertHistory)}
                className="text-xs text-bo-accent font-semibold hover:underline flex items-center gap-1"
              >
                {showAlertHistory ? 'Reduire' : 'Voir tout'}
                {showAlertHistory ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
              </button>
            </div>
            <div className="space-y-2">
              {(showAlertHistory ? cashControlAlertHistory : cashControlAlertHistory.slice(0, 3)).map((alert, i) => (
                <div key={i} className="flex items-center justify-between py-2 border-b border-gray-50 last:border-0">
                  <div>
                    <p className="text-sm font-medium text-bo-text">{alert.caissier}</p>
                    <p className="text-[10px] text-gray-400">{alert.date} — {alert.type}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                      alert.score >= 60 ? 'bg-red-100 text-red-700' :
                      alert.score >= 30 ? 'bg-amber-100 text-amber-700' :
                      'bg-blue-100 text-blue-700'
                    }`}>
                      {alert.score}
                    </span>
                    <span className={`text-[9px] font-semibold px-2 py-0.5 rounded-full ${
                      alert.statut === 'En cours' ? 'bg-red-50 text-red-600 ring-1 ring-red-200' :
                      alert.statut === 'Resolu' ? 'bg-emerald-50 text-emerald-600 ring-1 ring-emerald-200' :
                      'bg-gray-50 text-gray-500 ring-1 ring-gray-200'
                    }`}>
                      {alert.statut}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* DISCLAIMER STRATÉGIQUE */}
        <div className="bg-gradient-to-r from-slate-800 via-slate-700 to-slate-800 rounded-2xl p-5 text-white">
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-xl bg-amber-500/20 flex items-center justify-center flex-shrink-0 mt-0.5">
              <Shield size={16} className="text-amber-400" />
            </div>
            <div>
              <p className="text-xs font-bold text-white/70 uppercase tracking-wider mb-1">Protocole de controle interne</p>
              <p className="text-sm text-white/60 leading-relaxed">
                Ce module ne constitue pas une preuve. Un Risk Score eleve declenche une investigation, pas une sanction.
                Toujours correler avec : profil clientele, horaires specifiques, localisation, periode du mois (debut vs fin),
                et historique du caissier. Les faux positifs sont filtres par l'analyse croisee (annulations + remboursements +
                ecarts caisse + vitesse encaissement + heures de travail). Rapport hebdomadaire automatique envoye au manager.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ╔═══════════════════════════════════════════════════════════╗
         ║  E. INTELLIGENCE ARTIFICIELLE                             ║
         ╚═══════════════════════════════════════════════════════════╝ */}
      <section className="space-y-4">
        <SectionHeader
          icon={Brain}
          title="E. Intelligence Artificielle"
          subtitle="Tendances, anomalies, previsions, actions concretes"
          color="bg-gradient-to-br from-bo-accent to-violet-500"
        />

        {/* Tendances */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="bg-gradient-to-br from-indigo-50 via-white to-violet-50 rounded-2xl p-5 shadow-soft border border-indigo-100">
            <h4 className="font-semibold text-bo-text mb-4 flex items-center gap-2">
              <TrendingUp size={14} className="text-bo-accent" />
              Tendances detectees
            </h4>
            <div className="space-y-2">
              {aiInsights.tendances.map((t, i) => (
                <div key={i} className={`flex items-center gap-3 px-3 py-2 rounded-xl ${
                  t.type === 'positive' ? 'bg-emerald-50/80' : 'bg-red-50/80'
                }`}>
                  {t.type === 'positive' ? (
                    <ArrowUpRight size={14} className="text-emerald-500 flex-shrink-0" />
                  ) : (
                    <ArrowDownRight size={14} className="text-red-500 flex-shrink-0" />
                  )}
                  <span className="text-sm text-bo-text">{t.label}</span>
                </div>
              ))}
            </div>

            {/* Comparaison semaine */}
            <div className="mt-4 bg-white rounded-xl p-4 border border-gray-100">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">VS Semaine precedente</p>
              <div className="flex items-center gap-4">
                <div>
                  <p className="text-xl font-black text-bo-text">{fmtK(aiInsights.compaSemaine.caActuel)}</p>
                  <p className="text-[10px] text-gray-400">Cette semaine (partiel)</p>
                </div>
                <span className={`text-sm font-bold px-2.5 py-1 rounded-full ${
                  aiInsights.compaSemaine.positive ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'
                }`}>
                  {aiInsights.compaSemaine.variation}
                </span>
                <div>
                  <p className="text-xl font-black text-gray-300">{fmtK(aiInsights.compaSemaine.caSemPrecedente)}</p>
                  <p className="text-[10px] text-gray-400">Semaine precedente</p>
                </div>
              </div>
            </div>
          </div>

          {/* Anomalies */}
          <div className="bg-gradient-to-br from-red-50 via-white to-amber-50 rounded-2xl p-5 shadow-soft border border-red-100/50">
            <h4 className="font-semibold text-bo-text mb-4 flex items-center gap-2">
              <AlertCircle size={14} className="text-red-500" />
              Anomalies detectees
            </h4>
            <div className="space-y-3">
              {aiInsights.anomalies.map((a, i) => (
                <div key={i} className={`flex items-start gap-3 px-3 py-3 rounded-xl border ${
                  a.severity === 'high' ? 'bg-red-50 border-red-200' :
                  a.severity === 'medium' ? 'bg-amber-50 border-amber-200' :
                  'bg-blue-50 border-blue-200'
                }`}>
                  <div className={`w-2 h-2 rounded-full mt-1.5 flex-shrink-0 ${
                    a.severity === 'high' ? 'bg-red-500 animate-pulse' :
                    a.severity === 'medium' ? 'bg-amber-500' :
                    'bg-blue-500'
                  }`} />
                  <div>
                    <p className="text-sm text-bo-text font-medium">{a.message}</p>
                    <p className="text-[10px] text-gray-400 mt-0.5">
                      Severite : {a.severity === 'high' ? 'Haute' : a.severity === 'medium' ? 'Moyenne' : 'Faible'}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Actions concrètes */}
        <div className="bg-white rounded-2xl p-5 shadow-soft border border-gray-100/50">
          <h4 className="font-semibold text-bo-text mb-4 flex items-center gap-2">
            <Zap size={14} className="text-bo-accent" />
            Actions concretes prioritaires
          </h4>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {aiInsights.actionsConcretes.map((a, i) => (
              <div key={i} className="flex items-start gap-3 bg-gray-50 rounded-xl p-4 hover:bg-gray-100/80 transition-colors">
                <span className={`text-[10px] font-black px-2 py-0.5 rounded mt-0.5 flex-shrink-0 ${a.color}`}>
                  {a.priority}
                </span>
                <div>
                  <p className="text-sm font-medium text-bo-text">{a.action}</p>
                  <p className="text-[11px] text-gray-400 mt-0.5">Impact : {a.impact}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Prévisions + Objectif dynamique */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Prévision CA */}
          <div className="bg-gradient-to-br from-bo-sidebar via-slate-800 to-slate-900 rounded-2xl p-5 text-white">
            <h4 className="text-xs font-semibold text-white/50 uppercase tracking-wider mb-4 flex items-center gap-2">
              <Activity size={12} />
              Prevision CA (IA)
            </h4>
            <div className="grid grid-cols-3 gap-4">
              <div>
                <p className="text-2xl font-black">{fmtK(aiInsights.previsionCA.demain)}</p>
                <p className="text-[10px] text-white/40">Demain</p>
              </div>
              <div>
                <p className="text-2xl font-black">{fmtK(aiInsights.previsionCA.semaine)}</p>
                <p className="text-[10px] text-white/40">Semaine</p>
              </div>
              <div>
                <p className="text-2xl font-black">{fmtK(aiInsights.previsionCA.mois)}</p>
                <p className="text-[10px] text-white/40">Mois</p>
              </div>
            </div>
            <div className="mt-4 flex items-center gap-2">
              <span className="text-[10px] text-white/40">Indice de confiance :</span>
              <div className="flex-1 h-1.5 bg-white/10 rounded-full overflow-hidden">
                <div className="h-full bg-emerald-400 rounded-full" style={{ width: `${aiInsights.previsionCA.confiance}%` }} />
              </div>
              <span className="text-xs font-bold text-emerald-400">{aiInsights.previsionCA.confiance}%</span>
            </div>
          </div>

          {/* Objectif dynamique */}
          <div className="bg-gradient-to-br from-indigo-50 via-white to-violet-50 rounded-2xl p-5 shadow-soft border border-indigo-100">
            <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-4 flex items-center gap-2">
              <Target size={12} />
              Objectif dynamique (suggere par IA)
            </h4>
            <div className="grid grid-cols-3 gap-4 mb-4">
              <div>
                <p className="text-xl font-black text-bo-text">{fmtK(aiInsights.objectifDynamique.jourSuggere)}</p>
                <p className="text-[10px] text-gray-400">Objectif jour</p>
              </div>
              <div>
                <p className="text-xl font-black text-bo-text">{fmtK(aiInsights.objectifDynamique.semaineSuggere)}</p>
                <p className="text-[10px] text-gray-400">Objectif semaine</p>
              </div>
              <div>
                <p className="text-xl font-black text-bo-text">{fmtK(aiInsights.objectifDynamique.moisSuggere)}</p>
                <p className="text-[10px] text-gray-400">Objectif mois</p>
              </div>
            </div>
            <div className="bg-white rounded-xl px-4 py-3 border border-gray-100">
              <p className="text-xs text-gray-500 flex items-start gap-2">
                <Lightbulb size={14} className="text-amber-500 flex-shrink-0 mt-0.5" />
                {aiInsights.objectifDynamique.justification}
              </p>
            </div>
          </div>
        </div>

        {/* Strategic vision */}
        <div className="bg-gradient-to-r from-bo-sidebar via-slate-800 to-indigo-900 rounded-2xl p-6 text-white">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-xl bg-white/10 flex items-center justify-center">
              <Building2 size={18} className="text-white" />
            </div>
            <div>
              <p className="text-xs font-semibold text-white/50 uppercase tracking-wider">Vision Reseau 20+ Magasins</p>
              <p className="text-sm font-semibold">Recommandation strategique</p>
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-4">
            <div className="bg-white/5 rounded-xl p-4 border border-white/10">
              <p className="text-xs font-semibold text-emerald-400 mb-1">Court terme (1 mois)</p>
              <p className="text-sm text-white/80 leading-relaxed">
                Deployer l'upsell automatise sur ecran caisse. Optimiser le staffing 14h-17h samedi. Prevision : +5% CA.
              </p>
            </div>
            <div className="bg-white/5 rounded-xl p-4 border border-white/10">
              <p className="text-xs font-semibold text-amber-400 mb-1">Moyen terme (3 mois)</p>
              <p className="text-sm text-white/80 leading-relaxed">
                Programme fidelite x2 points. Pricing dynamique par creneau. Cross-sell ecran client. Prevision : +12% CA.
              </p>
            </div>
            <div className="bg-white/5 rounded-xl p-4 border border-white/10">
              <p className="text-xs font-semibold text-violet-400 mb-1">Long terme (12 mois)</p>
              <p className="text-sm text-white/80 leading-relaxed">
                IA predictive pour reappro automatique. Benchmarking inter-magasins. Objectifs personnalises par zone. Prevision : +25% CA reseau.
              </p>
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
