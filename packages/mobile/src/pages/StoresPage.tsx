// ── Classement des points de vente (lecture seule) ───────────────
// Tri : CA, progression, panier moyen, tickets, articles, CA/heure
// active, marge estimée, taux de remise, taux de remboursement.
// CA/m² : surface absente du modèle → affiché comme indisponible.
// ─────────────────────────────────────────────────────────────────

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import { analyticsApi } from '../services/api';
import { useSelectionStore } from '../stores/selectionStore';
import { useApi } from '../hooks/useApi';
import { PeriodPicker, useCurrentPeriodParams } from '../components/PeriodPicker';
import {
  DeltaBadge, ErrorBanner, LoadingCards, PageHeader, Segmented, SyncBadge, Unavailable,
} from '../components/ui';
import { formatInt, formatMoney, formatMoneyCompact, formatPct } from '../lib/format';

type SortKey =
  | 'revenue' | 'growth' | 'avgTicket' | 'tickets' | 'items'
  | 'revenuePerHour' | 'margin' | 'discountRate' | 'refundRate';

const SORTS: Array<{ key: SortKey; label: string }> = [
  { key: 'revenue', label: 'CA' },
  { key: 'growth', label: 'Progression' },
  { key: 'avgTicket', label: 'Panier moyen' },
  { key: 'tickets', label: 'Tickets' },
  { key: 'items', label: 'Articles' },
  { key: 'revenuePerHour', label: 'CA / heure active' },
  { key: 'margin', label: 'Marge estimée' },
  { key: 'discountRate', label: 'Taux de remise' },
  { key: 'refundRate', label: 'Taux remboursement' },
];

function metric(e: any, sort: SortKey): string {
  switch (sort) {
    case 'growth':
      return formatPct(e.growthPct);
    case 'avgTicket':
      return formatMoney(e.avgTicketMinorUnits);
    case 'tickets':
      return formatInt(e.tickets);
    case 'items':
      return formatInt(e.itemsSold);
    case 'revenuePerHour':
      return formatMoneyCompact(e.revenuePerActiveHourMinorUnits);
    case 'margin':
      return e.marginMinorUnits === null ? '—' : formatMoneyCompact(e.marginMinorUnits);
    case 'discountRate':
      return formatPct(e.discountRatePct);
    case 'refundRate':
      return formatPct(e.refundRatePct);
    default:
      return formatMoneyCompact(e.revenueMinorUnits);
  }
}

export function StoresPage() {
  const navigate = useNavigate();
  const period = useCurrentPeriodParams();
  const setSelection = useSelectionStore((st) => st.setAll);
  const [sort, setSort] = useState<SortKey>('revenue');

  const ranking = useApi(
    `stores:${period.from}:${period.to}:${sort}`,
    () => analyticsApi.stores({ from: period.from, to: period.to, tz: period.tz, sort }),
    [period.from, period.to, sort],
  );
  const d: any = ranking.data;

  return (
    <div className="pb-4">
      <PageHeader title="Points de vente" subtitle={`Classement — ${period.label}`} />
      <div className="px-4 pt-3 space-y-3">
        <div className="flex items-center justify-between">
          <PeriodPicker />
        </div>
        <Segmented options={SORTS} value={sort} onChange={setSort} />

        {ranking.error && <ErrorBanner message={ranking.error} onRetry={ranking.reload} />}
        <SyncBadge syncedAt={ranking.syncedAt} fromCache={ranking.fromCache} onReload={ranking.reload} loading={ranking.loading} />

        {ranking.loading && !d ? (
          <LoadingCards count={4} />
        ) : d?.stores?.length ? (
          <div className="bg-mobile-card rounded-2xl shadow-card divide-y divide-mobile-border/50">
            {d.stores.map((e: any) => (
              <button
                key={e.storeId}
                onClick={() => navigate(`/stores/${e.storeId}`)}
                className="w-full flex items-center gap-3 px-3.5 py-3 text-left active:bg-mobile-subtle"
              >
                <span className={`w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-bold shrink-0 ${
                  e.rank <= 3 ? 'bg-mobile-accent text-white' : 'bg-mobile-subtle text-mobile-muted'
                }`}>
                  {e.rank}
                </span>
                <span className="flex-1 min-w-0">
                  <span className="block text-sm font-semibold truncate">{e.name}</span>
                  <span className="block text-[11px] text-mobile-muted truncate">
                    {e.city ? `${e.city} · ` : ''}{formatInt(e.tickets)} tickets · panier {formatMoney(e.avgTicketMinorUnits)}
                  </span>
                </span>
                <span className="text-right shrink-0">
                  <span className="block text-sm font-bold tabular-nums">{metric(e, sort)}</span>
                  <DeltaBadge pct={e.growthPct} />
                </span>
                {/* Raccourci VS : ce magasin devient la base de la comparaison */}
                <span
                  role="button"
                  aria-label={`Comparer ${e.name}`}
                  onClick={(ev) => {
                    ev.stopPropagation();
                    setSelection([e.storeId]);
                    navigate('/compare');
                  }}
                  className="text-[10px] font-black text-mobile-accent px-2 py-1.5 rounded-lg bg-mobile-accent/10 shrink-0"
                >
                  VS
                </span>
                <ChevronRight size={15} className="text-mobile-border shrink-0" />
              </button>
            ))}
          </div>
        ) : d ? (
          <Unavailable label="Aucune vente sur la période" />
        ) : null}

        {sort === 'margin' && d?.stores?.length > 0 && (
          <p className="text-[11px] text-mobile-muted px-1">
            Marge estimée sur le coût produit actuel (le coût n'est pas figé à la vente) —
            « — » quand aucun coût n'est renseigné.
          </p>
        )}
      </div>
    </div>
  );
}
