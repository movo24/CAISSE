import { useState, useEffect } from 'react';
import {
  TrendingUp, TrendingDown, Minus, Clock, User, Smartphone, Monitor,
  BarChart3, Loader2, ChevronDown, ChevronUp,
} from 'lucide-react';
import { productsApi } from '../services/api';

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
  changedBy: string;
  changedByRole: string;
  changeSource: string;
  reason: string;
  vs: {
    priceDeltaPct: number | null;
    unitsPerDayDeltaPct: number | null;
    revenuePerDayDeltaPct: number | null;
  } | null;
}

interface PriceAnalytics {
  productId: string;
  productName: string;
  currentPriceMinorUnits: number;
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
              <th className="text-right py-2 px-2 font-semibold text-bo-muted">CA</th>
              <th className="text-right py-2 px-2 font-semibold text-bo-muted">CA/j</th>
              <th className="text-center py-2 px-2 font-semibold text-bo-muted">Δ Prix</th>
              <th className="text-center py-2 px-2 font-semibold text-bo-muted">Δ Vol/j</th>
              <th className="text-center py-2 px-2 font-semibold text-bo-muted">Δ CA/j</th>
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
                <td className="text-right py-2.5 px-2 font-semibold text-bo-text">{p.revenueEuros.toFixed(2)} €</td>
                <td className="text-right py-2.5 px-2 text-bo-muted">{p.revenuePerDay.toFixed(2)} €</td>
                <td className="text-center py-2.5 px-2"><DeltaBadge value={p.vs?.priceDeltaPct ?? null} /></td>
                <td className="text-center py-2.5 px-2"><DeltaBadge value={p.vs?.unitsPerDayDeltaPct ?? null} /></td>
                <td className="text-center py-2.5 px-2"><DeltaBadge value={p.vs?.revenuePerDayDeltaPct ?? null} /></td>
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
