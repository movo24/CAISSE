// ── Produits : recherche + classements (lecture seule) ───────────
// Recherche : nom, EAN/code-barres, marque, variante (serveur, ILIKE)
// + filtres catégorie/marque/fournisseur via paramètres API.
// Classements : plus vendus (qté), plus gros CA, meilleure progression,
// en baisse, faible rotation. Identité réseau d'un produit = EAN.
// ─────────────────────────────────────────────────────────────────

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, X } from 'lucide-react';
import { analyticsApi } from '../services/api';
import { useApi } from '../hooks/useApi';
import { PeriodPicker, useCurrentPeriodParams } from '../components/PeriodPicker';
import {
  DeltaBadge, ErrorBanner, LoadingCards, PageHeader, Segmented, SyncBadge, Unavailable,
} from '../components/ui';
import { formatInt, formatMoneyCompact } from '../lib/format';

type RankKey = 'qty' | 'revenue' | 'growth' | 'declining' | 'slow';

const RANKINGS: Array<{ key: RankKey; label: string }> = [
  { key: 'qty', label: 'Plus vendus' },
  { key: 'revenue', label: 'Plus gros CA' },
  { key: 'growth', label: 'En progression' },
  { key: 'declining', label: 'En baisse' },
  { key: 'slow', label: 'Faible rotation' },
];

export function ProductsPage() {
  const navigate = useNavigate();
  const period = useCurrentPeriodParams();
  const [rank, setRank] = useState<RankKey>('qty');
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search.trim()), 350);
    return () => clearTimeout(t);
  }, [search]);

  // growth/declining : tri client sur la progression réelle renvoyée par l'API
  // (croissance calculée serveur vs période précédente, null si pas de baseline).
  const apiSort = rank === 'revenue' ? 'revenue' : rank === 'slow' ? 'qty_asc' : 'qty';

  const list = useApi(
    `products:${period.from}:${period.to}:${apiSort}:${debounced}`,
    () =>
      analyticsApi.products({
        from: period.from,
        to: period.to,
        sort: apiSort,
        q: debounced || undefined,
        limit: '50',
      }),
    [period.from, period.to, apiSort, debounced],
  );

  const d: any = list.data;
  let rows: any[] = d?.products ?? [];
  if (rank === 'growth') {
    rows = rows
      .filter((p) => p.quantityGrowthPct !== null && p.quantityGrowthPct > 0)
      .sort((a, b) => (b.quantityGrowthPct ?? 0) - (a.quantityGrowthPct ?? 0));
  } else if (rank === 'declining') {
    rows = rows
      .filter((p) => p.quantityGrowthPct !== null && p.quantityGrowthPct < 0)
      .sort((a, b) => (a.quantityGrowthPct ?? 0) - (b.quantityGrowthPct ?? 0));
  }

  return (
    <div className="pb-4">
      <PageHeader title="Produits" subtitle={`Ventes réelles — ${period.label}`} />
      <div className="px-4 pt-3 space-y-3">
        {/* Recherche */}
        <div className="flex items-center gap-2 bg-mobile-card rounded-2xl shadow-soft px-3.5">
          <Search size={16} className="text-mobile-muted shrink-0" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Nom, code-barres, marque, variante…"
            className="flex-1 py-3 bg-transparent text-sm outline-none"
            inputMode="search"
          />
          {search && (
            <button onClick={() => setSearch('')} aria-label="Effacer" className="p-1">
              <X size={15} className="text-mobile-muted" />
            </button>
          )}
        </div>

        <div className="flex items-center justify-between">
          <PeriodPicker />
        </div>
        {!debounced && <Segmented options={RANKINGS} value={rank} onChange={setRank} />}

        {list.error && <ErrorBanner message={list.error} onRetry={list.reload} />}
        <SyncBadge syncedAt={list.syncedAt} fromCache={list.fromCache} onReload={list.reload} loading={list.loading} />

        {list.loading && !d ? (
          <LoadingCards count={4} />
        ) : rows.length ? (
          <div className="bg-mobile-card rounded-2xl shadow-card divide-y divide-mobile-border/50">
            {rows.map((p: any, i: number) => (
              <button
                key={p.ean}
                onClick={() => navigate(`/products/${encodeURIComponent(p.ean)}`)}
                className="w-full flex items-center gap-3 px-3.5 py-3 text-left active:bg-mobile-subtle"
              >
                <span className="text-[11px] font-bold text-mobile-muted w-5 shrink-0 tabular-nums">{i + 1}</span>
                {p.imageUrl ? (
                  <img src={p.imageUrl} alt="" className="w-9 h-9 rounded-lg object-cover bg-mobile-subtle shrink-0" />
                ) : (
                  <span className="w-9 h-9 rounded-lg bg-mobile-subtle shrink-0" />
                )}
                <span className="flex-1 min-w-0">
                  <span className="block text-sm font-semibold truncate">{p.name}</span>
                  <span className="block text-[11px] text-mobile-muted truncate">
                    {[p.brand, p.category, `${p.storeCount} magasin(s)`].filter(Boolean).join(' · ')}
                  </span>
                </span>
                <span className="text-right shrink-0">
                  <span className="block text-sm font-bold tabular-nums">
                    {rank === 'revenue' ? formatMoneyCompact(p.revenueMinorUnits) : `${formatInt(p.quantity)} u.`}
                  </span>
                  <DeltaBadge pct={p.quantityGrowthPct} />
                </span>
              </button>
            ))}
          </div>
        ) : d ? (
          <Unavailable label={debounced ? `Aucune vente trouvée pour « ${debounced} » sur la période` : 'Aucune vente sur la période'} />
        ) : null}

        {debounced && rows.length === 0 && d && (
          <CatalogFallback q={debounced} onSelect={(ean) => navigate(`/products/${encodeURIComponent(ean)}`)} />
        )}
      </div>
    </div>
  );
}

/** Repli catalogue : produits référencés mais sans vente sur la période. */
function CatalogFallback({ q, onSelect }: { q: string; onSelect: (ean: string) => void }) {
  const cat = useApi(`catalog:${q}`, () => analyticsApi.catalog({ q }), [q]);
  const rows: any[] = (cat.data as any) ?? [];
  if (cat.loading || !rows.length) return null;
  return (
    <div className="space-y-1.5">
      <p className="text-[11px] text-mobile-muted px-1">Au catalogue (sans vente sur la période) :</p>
      <div className="bg-mobile-card rounded-2xl shadow-card divide-y divide-mobile-border/50">
        {rows.map((p: any) => (
          <button
            key={p.ean}
            onClick={() => onSelect(p.ean)}
            className="w-full flex items-center gap-3 px-3.5 py-2.5 text-left active:bg-mobile-subtle"
          >
            <span className="flex-1 min-w-0">
              <span className="block text-sm font-semibold truncate">{p.name}</span>
              <span className="block text-[11px] text-mobile-muted truncate">
                {[p.brand, p.category].filter(Boolean).join(' · ')} · stock {formatInt(p.stockQuantity)}
              </span>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
