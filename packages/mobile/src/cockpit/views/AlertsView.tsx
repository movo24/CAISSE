import { cockpitApi } from '../api';
import { freshnessLabel } from '../format';
import { useCockpitFetch } from '../useCockpitFetch';

const BAND_STYLE: Record<string, string> = {
  critical: 'bg-red-100 text-red-700',
  warning: 'bg-amber-100 text-amber-700',
  rupture: 'bg-red-100 text-red-700',
  low_stock: 'bg-amber-100 text-amber-700',
  drop: 'bg-red-100 text-red-700',
  reached: 'bg-green-100 text-green-700',
  open_after_close: 'bg-amber-100 text-amber-700',
};

const RULE_LABEL: Record<string, string> = {
  void_rate: 'Taux d’annulation',
  discount_rate: 'Taux de remise',
  stock_low: 'Stock',
  sales_drop: 'Chute de CA',
  target_reached: 'Objectif atteint',
  store_closed_late: 'Fermeture tardive',
};

export function AlertsView() {
  const { data, error, loading, refresh } = useCockpitFetch(() => cockpitApi.alerts());

  if (loading) return <p className="p-4 text-sm text-mobile-muted">Chargement…</p>;
  if (error || !data) return (
    <div className="p-4 text-sm">
      <p>{error ?? 'Aucune alerte.'}</p>
      <button className="mt-2 text-mobile-accent font-semibold" onClick={refresh}>Réessayer</button>
    </div>
  );

  return (
    <div className="p-4 space-y-2">
      {data.length === 0 && <p className="text-sm text-mobile-muted">Aucune alerte sur la fenêtre courante. 👍</p>}
      {data.map((a) => (
        <div key={a.id} className="bg-white rounded-xl border border-mobile-border/60 p-4">
          <div className="flex items-center justify-between gap-2">
            <span className="font-semibold text-sm">{RULE_LABEL[a.rule] ?? a.rule}</span>
            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${BAND_STYLE[a.thresholdBand] ?? 'bg-gray-100 text-gray-600'}`}>
              {a.thresholdBand}
            </span>
          </div>
          <div className="text-[11px] text-mobile-muted mt-1">
            {a.businessDay} · fait {freshnessLabel(a.computedAt)}
          </div>
        </div>
      ))}
    </div>
  );
}
