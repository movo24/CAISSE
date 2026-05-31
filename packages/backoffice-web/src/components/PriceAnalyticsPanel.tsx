import { useState, useEffect } from 'react';
import {
  TrendingUp, TrendingDown, Minus, Clock, User, Smartphone, Monitor,
  BarChart3, Loader2, ChevronDown, ChevronUp, CheckCircle2, XCircle, AlertCircle,
} from 'lucide-react';
import { productsApi } from '../services/api';

type VerdictKind =
  | 'favorable' | 'unfavorable' | 'neutral' | 'no_price_change' | 'insufficient_data';

interface PriceVerdict {
  verdict: VerdictKind;
  label: string;
  priceDeltaPct: number | null;
  volumeDeltaPct: number | null;
  marginPerDayDeltaPct: number | null;
  reliability: 'ok' | 'low' | 'no_cost';
}

interface PricePeriod {
  periodIndex: number;
  priceMinorUnits: number;
  priceEuros: number;
  from: string;
  to: string;
  daysDuration: number;
  unitsSold: number;
  revenueMinorUnits: number;
  revenueEuros: number;
  unitsPerDay: number;
  revenuePerDay: number;
  // Margin fields (null when product has no cost)
  marginPercent: number | null;
  marginPerDayEuros: number | null;
  changedBy: string;
  changedByRole: string;
  changeSource: string;
  reason: string;
  vs: {
    priceDeltaPct: number | null;
    unitsPerDayDeltaPct: number | null;
    revenuePerDayDeltaPct: number | null;
    marginPerDayDeltaPct: number | null;
  } | null;
  verdict: PriceVerdict | null;
}

interface PriceAnalytics {
  productId: string;
  productName: string;
  currentPriceMinorUnits: number;
  currentCostMinorUnits: number | null;
  costBasis: 'current_cost_approx' | 'no_cost';
  periods: PricePeriod[];
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function DeltaBadge({ value, suffix = '%' }: { value: number | null; suffix?: string }) {
  if (value === null || value === undefined) return <span className="text-bo-muted">—</span>;
  const isPositive = value > 0;
  const isNegative = value < 0;
  return (
    <span className={`inline-flex items-center gap-0.5 text-xs font-bold ${
      isPositive ? 'text-emerald-600' : isNegative ? 'text-red-600' : 'text-bo-muted'
    }`}>
      {isPositive ? <TrendingUp size={11} /> : isNegative ? <TrendingDown size={11} /> : <Minus size={11} />}
      {isPositive ? '+' : ''}{value.toFixed(1)}{suffix}
    </span>
  );
}

function VerdictBadge({ verdict }: { verdict: PriceVerdict | null }) {
  if (!verdict || verdict.verdict === 'no_price_change') {
    return <span className="text-bo-muted">—</span>;
  }
  const cfg: Record<VerdictKind, { color: string; icon: typeof CheckCircle2; short: string }> = {
    favorable: { color: 'bg-emerald-50 text-emerald-700', icon: CheckCircle2, short: 'Validée' },
    unfavorable: { color: 'bg-red-50 text-red-600', icon: XCircle, short: 'Défavorable' },
    neutral: { color: 'bg-gray-50 text-gray-500', icon: Minus, short: 'Neutre' },
    no_price_change: { color: 'bg-gray-50 text-gray-400', icon: Minus, short: '—' },
    insufficient_data: { color: 'bg-amber-50 text-amber-600', icon: AlertCircle, short: 'Données ?' },
  };
  const c = cfg[verdict.verdict];
  const Icon = c.icon;
  return (
    <span
      title={verdict.label}
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold cursor-help ${c.color}`}
    >
      <Icon size={11} />
      {c.short}
      {verdict.reliability === 'low' && <span className="opacity-60">*</span>}
    </span>
  );
}

function SourceIcon({ source }: { source: string }) {
  if (source === 'mobile') return <Smartphone size={12} className="text-violet-500" />;
  if (source === 'backoffice') return <Monitor size={12} className="text-blue-500" />;
  return <Monitor size={12} className="text-bo-muted" />;
}

export function PriceAnalyticsPanel({ productId }: { productId: string }) {
  const [data, setData] = useState<PriceAnalytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (!productId) return;
    setLoading(true);
    productsApi.priceAnalytics(productId)
      .then((res) => setData(res.data))
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [productId]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 size={20} className="animate-spin text-bo-accent" />
      </div>
    );
  }

  if (!data || data.periods.length === 0) {
    return (
      <div className="text-center py-6 text-sm text-bo-muted">
        Aucun historique tarifaire disponible
      </div>
    );
  }

  const periods = data.periods;
  const visiblePeriods = expanded ? periods : periods.slice(-3); // Show last 3 by default

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold text-bo-text flex items-center gap-2">
          <BarChart3 size={16} className="text-bo-accent" />
          Historique tarifaire & impact
        </h3>
        {periods.length > 3 && (
          <button
            onClick={() => setExpanded(!expanded)}
            className="text-xs text-bo-accent font-semibold flex items-center gap-1 hover:underline"
          >
            {expanded ? 'Voir moins' : `Voir tout (${periods.length})`}
            {expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
          </button>
        )}
      </div>

      {/* Margin unavailable hint */}
      {data.costBasis === 'no_cost' && (
        <div className="flex items-start gap-2 text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          <AlertCircle size={13} className="mt-0.5 shrink-0" />
          <span>
            Coût d'achat non renseigné — la marge et le verdict ne peuvent pas être calculés.
            Ajoutez le coût du produit pour activer l'analyse de marge.
          </span>
        </div>
      )}

      {/* Table */}
      <div className="overflow-x-auto -mx-1">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-bo-border">
              <th className="text-left py-2 px-2 font-semibold text-bo-muted">Période</th>
              <th className="text-right py-2 px-2 font-semibold text-bo-muted">Prix</th>
              <th className="text-right py-2 px-2 font-semibold text-bo-muted">Jours</th>
              <th className="text-right py-2 px-2 font-semibold text-bo-muted">Qté</th>
              <th className="text-right py-2 px-2 font-semibold text-bo-muted">Moy/j</th>
              <th className="text-right py-2 px-2 font-semibold text-bo-muted">CA/j</th>
              <th className="text-right py-2 px-2 font-semibold text-bo-muted">Marge/j</th>
              <th className="text-center py-2 px-2 font-semibold text-bo-muted">Δ Prix</th>
              <th className="text-center py-2 px-2 font-semibold text-bo-muted">Δ Vol/j</th>
              <th className="text-center py-2 px-2 font-semibold text-bo-muted">Δ Marge/j</th>
              <th className="text-center py-2 px-2 font-semibold text-bo-muted">Verdict</th>
            </tr>
          </thead>
          <tbody>
            {visiblePeriods.map((p) => (
              <tr key={p.periodIndex} className="border-b border-bo-border/50 hover:bg-bo-subtle/50">
                <td className="py-2.5 px-2">
                  <div className="flex flex-col">
                    <span className="font-mono text-bo-text">{formatDate(p.from)}</span>
                    <span className="text-bo-muted">→ {formatDate(p.to)}</span>
                  </div>
                </td>
                <td className="text-right py-2.5 px-2 font-bold text-bo-text">{p.priceEuros.toFixed(2)} €</td>
                <td className="text-right py-2.5 px-2 text-bo-muted">{p.daysDuration}j</td>
                <td className="text-right py-2.5 px-2 font-semibold text-bo-text">{p.unitsSold}</td>
                <td className="text-right py-2.5 px-2 text-bo-muted">{p.unitsPerDay}</td>
                <td className="text-right py-2.5 px-2 text-bo-muted">{p.revenuePerDay.toFixed(2)} €</td>
                <td className="text-right py-2.5 px-2 font-semibold text-bo-text">
                  {p.marginPerDayEuros !== null ? `${p.marginPerDayEuros.toFixed(2)} €` : '—'}
                </td>
                <td className="text-center py-2.5 px-2"><DeltaBadge value={p.vs?.priceDeltaPct ?? null} /></td>
                <td className="text-center py-2.5 px-2"><DeltaBadge value={p.vs?.unitsPerDayDeltaPct ?? null} /></td>
                <td className="text-center py-2.5 px-2"><DeltaBadge value={p.vs?.marginPerDayDeltaPct ?? null} /></td>
                <td className="text-center py-2.5 px-2"><VerdictBadge verdict={p.verdict} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Change log (last 3 changes) */}
      <div className="space-y-2">
        <p className="text-[10px] font-semibold text-bo-muted uppercase tracking-wider">Dernières modifications</p>
        {periods.filter(p => p.changedBy !== 'initial').slice(-3).reverse().map((p) => (
          <div key={p.periodIndex} className="flex items-center gap-2 text-xs text-bo-muted">
            <Clock size={11} />
            <span className="font-mono">{formatDate(p.from)}</span>
            <span>—</span>
            <User size={11} />
            <span className="font-medium text-bo-text">{p.changedBy}</span>
            <span className="text-[10px] bg-bo-subtle px-1.5 py-0.5 rounded font-semibold">{p.changedByRole}</span>
            <SourceIcon source={p.changeSource} />
            {p.reason !== '-' && (
              <span className="text-[10px] italic truncate max-w-[150px]">{p.reason}</span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
