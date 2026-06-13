import { useState } from 'react';
import { ChevronLeft } from 'lucide-react';
import { cockpitApi, CockpitStore } from '../api';
import { eurosFromMinor, freshnessLabel } from '../format';
import { useCockpitFetch } from '../useCockpitFetch';

function StoreDetail({ store, onBack }: { store: CockpitStore; onBack: () => void }) {
  const live = useCockpitFetch(() => cockpitApi.storeLive(store.storeId), [store.storeId]);
  const perf = useCockpitFetch(() => cockpitApi.storePerformance(store.storeId), [store.storeId]);

  return (
    <div className="p-4 space-y-3">
      <button onClick={onBack} className="flex items-center gap-1 text-mobile-accent font-semibold text-sm">
        <ChevronLeft size={16} /> Magasins
      </button>
      <h2 className="text-lg font-bold">{store.name}</h2>

      <div className="bg-white rounded-xl border border-mobile-border/60 p-4 space-y-1">
        <div className="text-[11px] text-mobile-muted font-semibold uppercase">Live</div>
        {live.loading && <p className="text-sm text-mobile-muted">Chargement…</p>}
        {live.error && <p className="text-sm">{live.error}</p>}
        {live.data && (
          <>
            <p className="text-sm">Sessions ouvertes : <b>{live.data.sessions.openSessions}</b> ({live.data.sessions.activeTerminals} terminaux)</p>
            <p className="text-sm">Présence : <b>{live.data.presence.presentCount}/{live.data.presence.expectedCount}</b></p>
            <p className="text-sm">Ruptures : <b>{live.data.stock.ruptureCount}</b> · stock bas : <b>{live.data.stock.lowStockCount}</b></p>
            <p className="text-[11px] text-mobile-muted">{freshnessLabel(live.data.computedAt)}</p>
          </>
        )}
      </div>

      <div className="bg-white rounded-xl border border-mobile-border/60 p-4 space-y-1">
        <div className="text-[11px] text-mobile-muted font-semibold uppercase">Performance (jour)</div>
        {perf.loading && <p className="text-sm text-mobile-muted">Chargement…</p>}
        {perf.error && <p className="text-sm">{perf.error}</p>}
        {perf.data && (
          <>
            <p className="text-sm">CA brut : <b>{eurosFromMinor(perf.data.caBrutMinor)}</b> · net : <b>{eurosFromMinor(perf.data.netMinor)}</b></p>
            <p className="text-sm">Tickets : <b>{perf.data.txCount}</b> · panier moyen : <b>{eurosFromMinor(perf.data.avgBasketMinor)}</b></p>
            <p className="text-sm">Annulations : <b>{perf.data.voidCount}</b> · retours : <b>{eurosFromMinor(perf.data.returnsAmountMinor)}</b></p>
            <p className="text-[11px] text-mobile-muted">{freshnessLabel(perf.data.computedAt)}</p>
          </>
        )}
      </div>
    </div>
  );
}

export function StoresView() {
  const { data, error, loading, refresh } = useCockpitFetch(() => cockpitApi.stores());
  const [selected, setSelected] = useState<CockpitStore | null>(null);

  if (selected) return <StoreDetail store={selected} onBack={() => setSelected(null)} />;
  if (loading) return <p className="p-4 text-sm text-mobile-muted">Chargement…</p>;
  if (error || !data) return (
    <div className="p-4 text-sm">
      <p>{error ?? 'Aucun magasin.'}</p>
      <button className="mt-2 text-mobile-accent font-semibold" onClick={refresh}>Réessayer</button>
    </div>
  );

  return (
    <div className="p-4 space-y-2">
      {data.map((s) => (
        <button
          key={s.storeId}
          onClick={() => setSelected(s)}
          className="w-full text-left bg-white rounded-xl border border-mobile-border/60 p-4 touch-target"
        >
          <div className="font-semibold">{s.name}</div>
          <div className="text-[11px] text-mobile-muted">{s.isActive ? 'Actif' : 'Inactif'} · {freshnessLabel(s.computedAt)}</div>
        </button>
      ))}
      {data.length === 0 && <p className="text-sm text-mobile-muted">Aucun magasin dans ton périmètre.</p>}
    </div>
  );
}
