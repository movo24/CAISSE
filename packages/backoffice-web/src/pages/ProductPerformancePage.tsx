import { useState, useEffect } from 'react';
import { TrendingUp, TrendingDown, Snowflake, PackagePlus, AlertTriangle, Gauge } from 'lucide-react';
import { reportsApi } from '../services/api';
import { useCurrentStoreId } from '../hooks/useCurrentStoreId';

/* Forme renvoyée par GET /reports/product-analytics (dérivée des ventes figées). */
interface AnalyticsItem {
  productId: string;
  name: string;
  ean?: string | null;
  stockQuantity: number;
  valeurStockMinorUnits: number;
  unitsSold7d: number;
  unitsSold30d: number;
  dailyVelocity: number;
  lastSoldAt: string | null;
  daysSinceLastSale: number | null;
  daysUntilStockout: number | null;
  suggestedReorderQty: number;
  trendPct: number | null;
  classification: string;
  needsReorder: boolean;
  declining: boolean;
}
interface Report {
  top: AnalyticsItem[];
  flop: AnalyticsItem[];
  dormant: AnalyticsItem[];
  reorder: AnalyticsItem[];
  generatedAt: string;
}

interface Baseline { date: string; caMinorUnits: number; deltaPct: number | null; }
interface SalesTrend {
  comparisons: {
    today: { date: string; caMinorUnits: number };
    jMinus1: Baseline; sMinus1: Baseline; mMinus1: Baseline; nMinus1: Baseline;
  };
  forecast: { date: string; predictedMinorUnits: number; method: string; sampleSize: number };
}

const FORECAST_LABEL: Record<string, string> = {
  'weekday-average': 'moyenne même jour de semaine',
  'moving-average-7': 'moyenne mobile 7j',
  'insufficient-data': 'données insuffisantes',
};

function eur(minor: number): string {
  return `${(minor / 100).toFixed(2)} €`;
}
function frDate(iso: string | null): string {
  return iso ? new Date(iso).toLocaleDateString('fr-FR') : 'Jamais';
}
function Trend({ pct }: { pct: number | null }) {
  if (pct === null) return <span className="text-gray-400">—</span>;
  const up = pct >= 0;
  return (
    <span className={`inline-flex items-center gap-1 font-semibold ${up ? 'text-emerald-600' : 'text-red-600'}`}>
      {up ? <TrendingUp size={13} /> : <TrendingDown size={13} />}{pct > 0 ? '+' : ''}{pct}%
    </span>
  );
}

function CaCompareCard({ label, base, today }: { label: string; base: Baseline; today: number }) {
  const up = (base.deltaPct ?? 0) >= 0;
  return (
    <div className="bg-gray-50 rounded-xl p-3">
      <div className="text-[11px] text-gray-500">{label}</div>
      <div className="text-sm font-semibold text-gray-800">{eur(base.caMinorUnits)}</div>
      {base.deltaPct === null ? (
        <div className="text-[11px] text-gray-400">pas de base</div>
      ) : (
        <div className={`inline-flex items-center gap-1 text-[11px] font-semibold ${up ? 'text-emerald-600' : 'text-red-600'}`}>
          {up ? <TrendingUp size={11} /> : <TrendingDown size={11} />}{base.deltaPct > 0 ? '+' : ''}{base.deltaPct}%
        </div>
      )}
    </div>
  );
}

export function ProductPerformancePage() {
  const storeId = useCurrentStoreId();
  const [report, setReport] = useState<Report | null>(null);
  const [trend, setTrend] = useState<SalesTrend | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!storeId) return;
    setLoading(true);
    Promise.allSettled([
      reportsApi.productAnalytics(storeId),
      reportsApi.salesTrend(storeId),
    ])
      .then(([analyticsRes, trendRes]) => {
        if (analyticsRes.status === 'fulfilled') { setReport(analyticsRes.value.data); setError(null); }
        else { setError('Impossible de charger l\'analyse produit.'); }
        if (trendRes.status === 'fulfilled') setTrend(trendRes.value.data);
      })
      .finally(() => setLoading(false));
  }, [storeId]);

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <header className="flex items-center gap-3">
        <Gauge className="text-indigo-600" />
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Performance & Réassort</h1>
          <p className="text-sm text-gray-500">Top / flop / dormants + rupture probable & quantité de réassort — calculé sur les ventes (30 jours)</p>
        </div>
      </header>

      {loading && <p className="text-gray-500 text-sm">Chargement…</p>}
      {error && <p className="text-red-600 text-sm">{error}</p>}

      {/* ── Tendance CA & prévision (comparaisons + extrapolation simple) ── */}
      {trend && (
        <section className="bg-white rounded-2xl p-5 border border-gray-100 shadow-sm">
          <h2 className="font-semibold text-gray-800 mb-4 flex items-center gap-2"><TrendingUp size={16} className="text-indigo-500" /> Tendance CA & prévision</h2>
          <div className="grid grid-cols-2 md:grid-cols-6 gap-3 items-stretch">
            <div className="bg-indigo-600 text-white rounded-xl p-3">
              <div className="text-[11px] opacity-80">Aujourd'hui (en cours)</div>
              <div className="text-lg font-bold">{eur(trend.comparisons.today.caMinorUnits)}</div>
              <div className="text-[10px] opacity-70">journée partielle vs jours complets</div>
            </div>
            <CaCompareCard label="vs hier (J-1)" base={trend.comparisons.jMinus1} today={trend.comparisons.today.caMinorUnits} />
            <CaCompareCard label="vs S-1" base={trend.comparisons.sMinus1} today={trend.comparisons.today.caMinorUnits} />
            <CaCompareCard label="vs M-1" base={trend.comparisons.mMinus1} today={trend.comparisons.today.caMinorUnits} />
            <CaCompareCard label="vs N-1" base={trend.comparisons.nMinus1} today={trend.comparisons.today.caMinorUnits} />
            <div className="bg-emerald-50 rounded-xl p-3 border border-emerald-100">
              <div className="text-[11px] text-emerald-700">Prévision demain</div>
              <div className="text-lg font-bold text-emerald-800">{eur(trend.forecast.predictedMinorUnits)}</div>
              <div className="text-[10px] text-emerald-600">{FORECAST_LABEL[trend.forecast.method] || trend.forecast.method} · n={trend.forecast.sampleSize}</div>
            </div>
          </div>
          <p className="text-[11px] text-gray-400 mt-2">Extrapolation simple (pas d'IA) — fiabilité limitée tant que l'historique est court.</p>
        </section>
      )}

      {report && (
        <>
          {/* ── Réassort : le plus actionnable, en tête ── */}
          <section className="bg-white rounded-2xl p-5 border border-gray-100 shadow-sm">
            <h2 className="font-semibold text-gray-800 mb-4 flex items-center gap-2"><PackagePlus size={16} className="text-amber-500" /> À recommander ({report.reorder.length})</h2>
            {report.reorder.length === 0 ? (
              <p className="text-sm text-gray-400">Aucune rupture imminente détectée au rythme actuel. 👍</p>
            ) : (
              <table className="w-full text-sm">
                <thead><tr className="text-left text-gray-500 border-b">
                  <th className="py-2">Produit</th><th className="text-right">Stock</th><th className="text-right">Vélocité/j</th>
                  <th className="text-right">Rupture dans</th><th className="text-right">Qté conseillée</th>
                </tr></thead>
                <tbody>
                  {report.reorder.map((p) => (
                    <tr key={p.productId} className="border-b border-gray-50">
                      <td className="py-2.5 font-medium">{p.name}</td>
                      <td className="py-2.5 text-right">{p.stockQuantity}</td>
                      <td className="py-2.5 text-right">{p.dailyVelocity}</td>
                      <td className="py-2.5 text-right">
                        <span className={`font-semibold ${(p.daysUntilStockout ?? 99) <= 3 ? 'text-red-600' : 'text-amber-600'}`}>
                          {p.daysUntilStockout} j
                        </span>
                      </td>
                      <td className="py-2.5 text-right font-bold text-indigo-600">+{p.suggestedReorderQty}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* ── Top ── */}
            <section className="bg-white rounded-2xl p-5 border border-gray-100 shadow-sm">
              <h2 className="font-semibold text-gray-800 mb-4 flex items-center gap-2"><TrendingUp size={16} className="text-emerald-500" /> Top ventes (30 j)</h2>
              <PerfTable items={report.top} showTrend />
              {report.top.length === 0 && <p className="text-sm text-gray-400">Pas encore de ventes.</p>}
            </section>

            {/* ── Flop ── */}
            <section className="bg-white rounded-2xl p-5 border border-gray-100 shadow-sm">
              <h2 className="font-semibold text-gray-800 mb-4 flex items-center gap-2"><TrendingDown size={16} className="text-red-500" /> En perte de vitesse</h2>
              <PerfTable items={report.flop} showTrend />
              {report.flop.length === 0 && <p className="text-sm text-gray-400">Aucun produit en déclin marqué.</p>}
            </section>
          </div>

          {/* ── Dormants ── */}
          <section className="bg-white rounded-2xl p-5 border border-gray-100 shadow-sm">
            <h2 className="font-semibold text-gray-800 mb-4 flex items-center gap-2"><Snowflake size={16} className="text-blue-400" /> Produits dormants ({report.dormant.length})</h2>
            {report.dormant.length === 0 ? <p className="text-sm text-gray-400">Aucun produit dormant.</p> : (
              <>
                <table className="w-full text-sm">
                  <thead><tr className="text-left text-gray-500 border-b">
                    <th className="py-2">Produit</th><th className="text-right">Dernière vente</th><th className="text-right">Stock</th><th className="text-right">Valeur immobilisée</th>
                  </tr></thead>
                  <tbody>
                    {report.dormant.map((p) => (
                      <tr key={p.productId} className="border-b border-gray-50">
                        <td className="py-2.5 font-medium">{p.name}</td>
                        <td className="py-2.5 text-right text-gray-500">{frDate(p.lastSoldAt)}</td>
                        <td className="py-2.5 text-right">{p.stockQuantity}</td>
                        <td className="py-2.5 text-right font-semibold">{eur(p.valeurStockMinorUnits)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="mt-3 bg-amber-50 rounded-xl px-3 py-2 flex items-center gap-2 text-amber-800 text-xs">
                  <AlertTriangle size={14} /> Valeur totale immobilisée :{' '}
                  <span className="font-bold">{eur(report.dormant.reduce((s, d) => s + d.valeurStockMinorUnits, 0))}</span>
                </div>
              </>
            )}
          </section>

          <p className="text-[11px] text-gray-400">Calcul simple sur ventes complétées (pas d'IA). Généré le {new Date(report.generatedAt).toLocaleString('fr-FR')}.</p>
        </>
      )}
    </div>
  );
}

function PerfTable({ items, showTrend }: { items: AnalyticsItem[]; showTrend?: boolean }) {
  if (items.length === 0) return null;
  return (
    <table className="w-full text-sm">
      <thead><tr className="text-left text-gray-500 border-b">
        <th className="py-2">Produit</th><th className="text-right">Vendus 30j</th><th className="text-right">Stock</th>
        {showTrend && <th className="text-right">Tendance</th>}
      </tr></thead>
      <tbody>
        {items.map((p) => (
          <tr key={p.productId} className="border-b border-gray-50">
            <td className="py-2.5 font-medium">{p.name}</td>
            <td className="py-2.5 text-right font-semibold">{p.unitsSold30d}</td>
            <td className="py-2.5 text-right">{p.stockQuantity}</td>
            {showTrend && <td className="py-2.5 text-right"><Trend pct={p.trendPct} /></td>}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
