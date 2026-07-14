// ── Analyses : carte thermique horaire + catégories (lecture seule) ──
// Onglet Heures : CA / tickets / panier par heure, heatmap jour×heure,
// heures de pointe et heures faibles.
// Onglet Catégories : CA, part, progression, meilleur magasin, top
// produits par catégorie.
// ─────────────────────────────────────────────────────────────────

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { analyticsApi } from '../services/api';
import { useApi } from '../hooks/useApi';
import { PeriodPicker, useCurrentPeriodParams } from '../components/PeriodPicker';
import {
  DeltaBadge, ErrorBanner, KpiCard, LoadingCards, PageHeader, Segmented, SyncBadge, Unavailable,
} from '../components/ui';
import { HeatmapGrid } from '../components/charts';
import { formatHour, formatInt, formatMoney, formatMoneyCompact, formatPct } from '../lib/format';

type Tab = 'hours' | 'categories';

export function AnalyticsPage() {
  const navigate = useNavigate();
  const period = useCurrentPeriodParams();
  const [tab, setTab] = useState<Tab>('hours');

  const heatmap = useApi(
    `heatmap:${period.from}:${period.to}`,
    () => analyticsApi.heatmap({ from: period.from, to: period.to, tz: period.tz }),
    [period.from, period.to],
  );
  const categories = useApi(
    `categories:${period.from}:${period.to}`,
    () => analyticsApi.categories({ from: period.from, to: period.to }),
    [period.from, period.to],
  );

  const hm: any = heatmap.data;
  const cats: any = categories.data;

  // Agrégat par heure (toutes journées confondues) pour heures fortes/faibles.
  const byHour = new Map<number, { revenue: number; tickets: number }>();
  if (hm?.cells) {
    for (const c of hm.cells) {
      const cur = byHour.get(c.hour) ?? { revenue: 0, tickets: 0 };
      byHour.set(c.hour, { revenue: cur.revenue + c.revenueMinorUnits, tickets: cur.tickets + c.tickets });
    }
  }
  const hourAgg = [...byHour.entries()]
    .map(([hour, v]) => ({ hour, ...v, avg: v.tickets ? Math.round(v.revenue / v.tickets) : null }))
    .sort((a, b) => b.revenue - a.revenue);

  return (
    <div className="pb-4">
      <PageHeader title="Analyses" subtitle={period.label} />
      <div className="px-4 pt-3 space-y-3">
        <div className="flex items-center justify-between">
          <PeriodPicker />
        </div>
        <Segmented
          options={[
            { key: 'hours' as Tab, label: 'Analyse horaire' },
            { key: 'categories' as Tab, label: 'Catégories' },
          ]}
          value={tab}
          onChange={setTab}
        />

        {tab === 'hours' && (
          <>
            {heatmap.error && <ErrorBanner message={heatmap.error} onRetry={heatmap.reload} />}
            <SyncBadge syncedAt={heatmap.syncedAt} fromCache={heatmap.fromCache} onReload={heatmap.reload} loading={heatmap.loading} />
            {heatmap.loading && !hm ? (
              <LoadingCards count={4} />
            ) : hm ? (
              <>
                <HeatmapGrid cells={hm.cells} />
                {hourAgg.length > 0 && (
                  <>
                    <div className="grid grid-cols-2 gap-3">
                      <KpiCard
                        label="Heure de pointe"
                        value={formatHour(hourAgg[0].hour)}
                        hint={formatMoneyCompact(hourAgg[0].revenue)}
                      />
                      <KpiCard
                        label="Heure faible"
                        value={formatHour(hourAgg[hourAgg.length - 1].hour)}
                        hint={formatMoneyCompact(hourAgg[hourAgg.length - 1].revenue)}
                      />
                    </div>
                    <div className="bg-mobile-card rounded-2xl shadow-card divide-y divide-mobile-border/50">
                      <div className="grid grid-cols-4 px-3.5 pt-2.5 pb-1 text-[10px] uppercase tracking-wide text-mobile-muted font-semibold">
                        <span>Heure</span><span className="text-right">CA</span><span className="text-right">Tickets</span><span className="text-right">Panier</span>
                      </div>
                      {[...hourAgg].sort((a, b) => a.hour - b.hour).map((h) => (
                        <div key={h.hour} className="grid grid-cols-4 px-3.5 py-2 text-sm tabular-nums">
                          <span className="font-semibold">{h.hour} h</span>
                          <span className="text-right">{formatMoneyCompact(h.revenue)}</span>
                          <span className="text-right">{formatInt(h.tickets)}</span>
                          <span className="text-right">{formatMoney(h.avg)}</span>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </>
            ) : null}
          </>
        )}

        {tab === 'categories' && (
          <>
            {categories.error && <ErrorBanner message={categories.error} onRetry={categories.reload} />}
            <SyncBadge syncedAt={categories.syncedAt} fromCache={categories.fromCache} onReload={categories.reload} loading={categories.loading} />
            {categories.loading && !cats ? (
              <LoadingCards count={4} />
            ) : cats?.categories?.length ? (
              <div className="space-y-3">
                {cats.categories.map((c: any) => (
                  <div key={c.category} className="bg-mobile-card rounded-2xl shadow-card p-3.5 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-bold truncate">{c.category}</p>
                      <DeltaBadge pct={c.growthPct} />
                    </div>
                    <div className="flex items-baseline gap-3">
                      <span className="text-xl font-bold tabular-nums">{formatMoneyCompact(c.revenueMinorUnits)}</span>
                      <span className="text-[11px] text-mobile-muted">
                        {c.sharePct !== null ? `${c.sharePct.toLocaleString('fr-FR')} % du CA` : '—'} · {formatInt(c.quantity)} articles
                      </span>
                    </div>
                    <div className="h-1.5 rounded-full bg-mobile-subtle overflow-hidden">
                      <div className="h-full rounded-full bg-mobile-accent/70" style={{ width: `${Math.min(c.sharePct ?? 0, 100)}%` }} />
                    </div>
                    {c.topStore && (
                      <p className="text-[11px] text-mobile-muted">
                        Meilleur magasin : <button className="font-semibold text-mobile-accent" onClick={() => navigate(`/stores/${c.topStore.storeId}`)}>{c.topStore.name}</button>
                        {' '}({formatMoneyCompact(c.topStore.revenueMinorUnits)})
                      </p>
                    )}
                    {c.topProducts.length > 0 && (
                      <p className="text-[11px] text-mobile-muted truncate">
                        Top : {c.topProducts.map((p: any) => p.name).join(' · ')}
                      </p>
                    )}
                    <p className="text-[11px] text-mobile-muted">
                      Évolution vs période préc. : {formatPct(c.growthPct)}
                    </p>
                  </div>
                ))}
              </div>
            ) : cats ? (
              <Unavailable label="Aucune vente sur la période" />
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
