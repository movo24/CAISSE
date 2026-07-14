// ── Sélecteur multi-magasins (feuille mobile) ────────────────────
// Liste complète des magasins : recherche (nom, ville, code), case à
// cocher, statut ouvert/fermé (session POS active), rang CA sur la
// période courante. Raccourcis : Tous, Aucun, Top 5, 5 plus faibles,
// Favoris (locaux), moyenne réseau en superposition.
// La sélection est conservée entre les écrans (selectionStore).
// ─────────────────────────────────────────────────────────────────

import { useMemo, useState } from 'react';
import { Check, ChevronDown, Search, Store as StoreIcon, X } from 'lucide-react';
import { analyticsApi, storesApi } from '../services/api';
import { useApi } from '../hooks/useApi';
import { useSelectionStore } from '../stores/selectionStore';
import { useCurrentPeriodParams } from './PeriodPicker';
import { storeColor } from '../lib/colors';

export interface PickableStore {
  id: string;
  name: string;
  city: string | null;
  storeCode?: string | null;
  openNow: boolean | null; // null = statut inconnu
  rank: number | null;
  revenueMinorUnits: number | null;
}

export function useNetworkStores(): { stores: PickableStore[]; loading: boolean; error: string | null; reload: () => void } {
  const period = useCurrentPeriodParams();
  const accessible = useApi('stores-accessible', () => storesApi.accessible(), []);
  const ranking = useApi(
    `stores:${period.from}:${period.to}:revenue`,
    () => analyticsApi.stores({ from: period.from, to: period.to, tz: period.tz, sort: 'revenue' }),
    [period.from, period.to],
  );

  const stores = useMemo<PickableStore[]>(() => {
    const list: any[] = Array.isArray(accessible.data) ? (accessible.data as any[]) : [];
    const rankBy = new Map<string, any>(
      ((ranking.data as any)?.stores ?? []).map((e: any) => [e.storeId, e]),
    );
    return list.map((s: any) => {
      const r = rankBy.get(s.id);
      return {
        id: s.id,
        name: s.name,
        city: s.city ?? null,
        storeCode: s.storeCode ?? null,
        openNow: r ? !!r.openNow : null,
        rank: r?.rank ?? null,
        revenueMinorUnits: r?.revenueMinorUnits ?? null,
      };
    });
  }, [accessible.data, ranking.data]);

  return {
    stores,
    loading: accessible.loading || ranking.loading,
    error: accessible.error,
    reload: () => {
      accessible.reload();
      ranking.reload();
    },
  };
}

export function StorePickerButton() {
  const [open, setOpen] = useState(false);
  const { storeIds } = useSelectionStore();
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-mobile-card shadow-soft text-xs font-semibold text-mobile-text"
        aria-label="Sélectionner les points de vente"
      >
        <StoreIcon size={13} className="text-mobile-accent" />
        {storeIds.length
          ? `${storeIds.length} point${storeIds.length > 1 ? 's' : ''} de vente`
          : 'Sélectionner les points de vente'}
        <ChevronDown size={13} className="text-mobile-muted" />
      </button>
      {open && <StorePickerSheet onClose={() => setOpen(false)} />}
    </>
  );
}

function StorePickerSheet({ onClose }: { onClose: () => void }) {
  const { stores, loading, error, reload } = useNetworkStores();
  const sel = useSelectionStore();
  const [q, setQ] = useState('');

  const filtered = stores.filter((s) => {
    if (!q.trim()) return true;
    const needle = q.trim().toLowerCase();
    return (
      s.name.toLowerCase().includes(needle) ||
      (s.city ?? '').toLowerCase().includes(needle) ||
      (s.storeCode ?? '').toLowerCase().includes(needle) ||
      s.id.toLowerCase().startsWith(needle)
    );
  });

  const ranked = stores.filter((s) => s.rank !== null).sort((a, b) => (a.rank! - b.rank!));
  const shortcuts: Array<{ label: string; run: () => void; disabled?: boolean }> = [
    { label: 'Tous les magasins', run: () => sel.setAll(stores.map((s) => s.id)) },
    { label: 'Aucun', run: () => sel.setAll([]) },
    { label: 'Top 5', run: () => sel.setAll(ranked.slice(0, 5).map((s) => s.id)), disabled: !ranked.length },
    { label: '5 plus faibles', run: () => sel.setAll(ranked.slice(-5).map((s) => s.id)), disabled: !ranked.length },
    { label: 'Mes favoris', run: () => sel.applyFavorites(), disabled: !sel.favorites.length },
    { label: 'Enregistrer comme favoris', run: () => sel.saveFavorites(), disabled: !sel.storeIds.length },
  ];

  return (
    <div className="fixed inset-0 z-40 flex items-end" onClick={onClose}>
      <div className="absolute inset-0 bg-black/30" />
      <div
        className="relative w-full bg-white rounded-t-3xl p-4 pb-8 animate-slide-up max-h-[85dvh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="w-10 h-1 bg-mobile-border rounded-full mx-auto mb-3 shrink-0" />
        <div className="flex items-center justify-between mb-2 shrink-0">
          <h3 className="text-sm font-bold">Points de vente</h3>
          <span className="text-[11px] font-semibold text-mobile-accent">
            {sel.storeIds.length} sélectionné{sel.storeIds.length > 1 ? 's' : ''}
          </span>
        </div>

        <div className="flex items-center gap-2 bg-mobile-subtle rounded-xl px-3 mb-2 shrink-0">
          <Search size={14} className="text-mobile-muted" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Nom, ville, code magasin…"
            className="flex-1 py-2.5 bg-transparent text-sm outline-none"
            inputMode="search"
          />
          {q && (
            <button onClick={() => setQ('')} aria-label="Effacer">
              <X size={14} className="text-mobile-muted" />
            </button>
          )}
        </div>

        <div className="flex gap-1.5 overflow-x-auto hide-scrollbar pb-2 shrink-0">
          {shortcuts.map((sc) => (
            <button
              key={sc.label}
              onClick={sc.run}
              disabled={sc.disabled}
              className="px-2.5 py-1.5 rounded-full bg-mobile-subtle text-[11px] font-semibold whitespace-nowrap disabled:opacity-40"
            >
              {sc.label}
            </button>
          ))}
        </div>

        <label className="flex items-center justify-between py-2 px-1 shrink-0">
          <span className="text-xs font-semibold">Superposer la moyenne réseau</span>
          <input
            type="checkbox"
            checked={sel.showNetworkAvg}
            onChange={(e) => sel.setShowNetworkAvg(e.target.checked)}
            className="w-4 h-4 accent-violet-600"
          />
        </label>

        <div className="flex-1 overflow-y-auto -mx-1 px-1">
          {error && (
            <p className="text-xs text-red-600 py-2">
              {error} <button className="underline font-semibold" onClick={reload}>Réessayer</button>
            </p>
          )}
          {loading && !stores.length && <p className="text-center text-xs text-mobile-muted py-6">Chargement…</p>}
          {filtered.map((s) => {
            const checked = sel.storeIds.includes(s.id);
            return (
              <button
                key={s.id}
                onClick={() => sel.toggle(s.id)}
                className="w-full flex items-center gap-3 py-2.5 px-1 text-left border-b border-mobile-border/40 last:border-0"
              >
                <span
                  className={`w-5 h-5 rounded-md flex items-center justify-center shrink-0 border ${
                    checked ? 'border-transparent' : 'border-mobile-border bg-white'
                  }`}
                  style={checked ? { backgroundColor: storeColor(s.id) } : undefined}
                >
                  {checked && <Check size={13} className="text-white" strokeWidth={3} />}
                </span>
                <span className="flex-1 min-w-0">
                  <span className="block text-sm font-semibold truncate">{s.name}</span>
                  <span className="block text-[11px] text-mobile-muted truncate">
                    {[s.city, s.storeCode].filter(Boolean).join(' · ') || '—'}
                    {s.rank !== null ? ` · ${s.rank}ᵉ au CA` : ''}
                  </span>
                </span>
                <span
                  className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-md shrink-0 ${
                    s.openNow === null
                      ? 'bg-mobile-subtle text-mobile-muted'
                      : s.openNow
                        ? 'bg-emerald-50 text-emerald-700'
                        : 'bg-mobile-subtle text-mobile-muted'
                  }`}
                >
                  {s.openNow === null ? 'statut inconnu' : s.openNow ? 'ouvert' : 'fermé'}
                </span>
              </button>
            );
          })}
          {!loading && !filtered.length && (
            <p className="text-center text-xs text-mobile-muted py-6">Aucun magasin ne correspond à « {q} »</p>
          )}
        </div>

        <button
          onClick={onClose}
          className="mt-3 w-full py-2.5 rounded-xl bg-mobile-accent text-white text-sm font-bold shrink-0"
        >
          Valider ({sel.storeIds.length})
        </button>
      </div>
    </div>
  );
}
