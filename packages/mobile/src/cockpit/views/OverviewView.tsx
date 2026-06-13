import { cockpitApi } from '../api';
import { eurosFromMinor, pctLabel, freshnessLabel } from '../format';
import { useCockpitFetch } from '../useCockpitFetch';

function Kpi({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="bg-white rounded-xl border border-mobile-border/60 p-3">
      <div className="text-[11px] text-mobile-muted">{label}</div>
      <div className={`text-lg font-bold ${accent ? 'text-mobile-accent' : ''}`}>{value}</div>
    </div>
  );
}

export function OverviewView() {
  const { data, error, loading, refresh } = useCockpitFetch(() => cockpitApi.overview());

  if (loading) return <p className="p-4 text-sm text-mobile-muted">Chargement…</p>;
  if (error || !data) return (
    <div className="p-4 text-sm">
      <p>{error ?? 'Aucune donnée.'}</p>
      <button className="mt-2 text-mobile-accent font-semibold" onClick={refresh}>Réessayer</button>
    </div>
  );

  return (
    <div className="p-4 space-y-3">
      <div className="grid grid-cols-2 gap-2">
        <Kpi label="CA brut (jour)" value={eurosFromMinor(data.sales.caBrutMinor)} accent />
        <Kpi label="CA net" value={eurosFromMinor(data.sales.caNetMinor)} />
        <Kpi label="Tickets" value={String(data.sales.txCount)} />
        <Kpi label="Annulations" value={String(data.sales.voidCount)} />
        <Kpi label="Retours" value={eurosFromMinor(data.sales.returnsAmountMinor)} />
        <Kpi
          label="Objectif"
          value={data.sales.targetMinor == null ? '— (non défini)' : `${pctLabel(data.sales.targetReachedPct)} de ${eurosFromMinor(data.sales.targetMinor)}`}
        />
      </div>
      <div className="grid grid-cols-3 gap-2">
        <Kpi label="Présents" value={`${data.presence.presentCount}/${data.presence.expectedCount}`} />
        <Kpi label="Sessions" value={`${data.sessions.openSessions} (${data.sessions.activeTerminals} term.)`} />
        <Kpi label="Ruptures" value={`${data.stock.ruptureCount} / ${data.stock.lowStockCount} bas`} />
      </div>
      <p className="text-[11px] text-mobile-muted">
        {data.scope.storeCount} magasin(s) · données {freshnessLabel(data.computedAt)}
      </p>
    </div>
  );
}
