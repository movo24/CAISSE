// ── Comparateur multi-points de vente (lecture seule) ────────────
// Un vrai moteur de comparaison : sélection libre de 1..N magasins
// (persistée entre les écrans), courbes nommées et colorées par
// magasin, lecture au doigt (crosshair) avec classement synchronisé
// au créneau, résumé chiffré + conclusions factuelles (jamais
// causales), matrice produits × magasins, et comparaison de périodes
// (aujourd'hui vs hier, même jour S-1/N-1, mois vs mois…).
// Changement d'indicateur = recalcul local, aucun re-fetch.
// ─────────────────────────────────────────────────────────────────

import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeftRight, RotateCcw } from 'lucide-react';
import { analyticsApi, storesApi } from '../services/api';
import { useApi } from '../hooks/useApi';
import { useAuthStore } from '../stores/authStore';
import { useSelectionStore } from '../stores/selectionStore';
import { PeriodPicker, useCurrentPeriodParams } from '../components/PeriodPicker';
import { StorePickerButton } from '../components/StorePicker';
import { MultiLineChart, SmallMultiples, ChartSeries } from '../components/MultiLineChart';
import {
  DeltaBadge, ErrorBanner, LoadingCards, PageHeader, Segmented, SyncBadge, Unavailable,
} from '../components/ui';
import { NETWORK_AVG_COLOR, storeColor } from '../lib/colors';
import { formatInt, formatMoney, formatMoneyCompact, formatPct } from '../lib/format';
import {
  aggregate, applyChartMode, bucketLabel, bucketTooltipLabel, buildConclusions,
  metricValue, rankAt, rankPeriod, ChartMode, MetricKey, METRICS, StoreSeries,
} from '../lib/series';
import { PeriodKey, PERIOD_LABELS, periodParams, periodWindow } from '../lib/periods';

type View = 'synthese' | 'detail' | 'produits' | 'periodes';

const fmtFor = (metric: MetricKey) => {
  const kind = METRICS.find((m) => m.key === metric)?.kind ?? 'count';
  return (v: number | null): string => {
    if (v === null) return '—';
    if (kind === 'money') return formatMoneyCompact(v);
    if (kind === 'ratio') return v.toLocaleString('fr-FR');
    return formatInt(v);
  };
};

export function ComparePage() {
  const navigate = useNavigate();
  const isAdmin = useAuthStore((s) => s.employee?.role === 'admin');
  const ownStoreId = useAuthStore((s) => s.employee?.storeId);
  const sel = useSelectionStore();
  const period = useCurrentPeriodParams();

  const [view, setView] = useState<View>('synthese');
  const [metric, setMetric] = useState<MetricKey>('revenue');
  const [chartMode, setChartMode] = useState<ChartMode>('all');
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [highlightId, setHighlightId] = useState<string | null>(null);

  // Manager : verrouillé serveur sur son magasin — la sélection locale est ignorée.
  const storeIds = isAdmin ? sel.storeIds : ownStoreId ? [ownStoreId] : [];

  const seriesReq = useApi(
    `series:${period.from}:${period.to}:${storeIds.join(',')}:${sel.showNetworkAvg}`,
    () =>
      analyticsApi.series({
        from: period.from,
        to: period.to,
        tz: period.tz,
        storeIds: storeIds.join(','),
        includeNetwork: sel.showNetworkAvg ? '1' : undefined,
      }),
    [period.from, period.to, storeIds.join(','), sel.showNetworkAvg],
    storeIds.length > 0,
  );
  const d: any = seriesReq.data;
  const bucket: string = d?.bucket ?? 'day';
  const series: StoreSeries[] = useMemo(() => d?.series ?? [], [d]);
  const domain: string[] = useMemo(() => d?.domain ?? [], [d]);

  const visible = useMemo(
    () => applyChartMode(series, chartMode === 'small' ? 'all' : chartMode),
    [series, chartMode],
  );
  const labels = useMemo(() => domain.map((t) => bucketLabel(t, bucket)), [domain, bucket]);
  const fmt = fmtFor(metric);

  const chartSeries: ChartSeries[] = useMemo(() => {
    const list: ChartSeries[] = visible.map((s) => ({
      id: s.storeId,
      name: s.name,
      color: storeColor(s.storeId),
      values: s.points.map((p) => metricValue(p, metric)),
    }));
    if (sel.showNetworkAvg && d?.network?.average && ['revenue', 'tickets', 'avgTicket', 'discount'].includes(metric)) {
      list.push({
        id: '__avg__',
        name: `Moyenne réseau (${d.network.storeCount} PDV)`,
        color: NETWORK_AVG_COLOR,
        dashed: true,
        values: d.network.average.map((p: any) => metricValue(p, metric)),
      });
    }
    return list;
  }, [visible, metric, sel.showNetworkAvg, d]);

  const toggleHighlight = (id: string) => setHighlightId((cur) => (cur === id ? null : id));

  // Classement synchronisé : au créneau actif, sinon sur la période.
  const ranking = useMemo(() => {
    if (activeIndex !== null && domain[activeIndex]) return rankAt(visible, activeIndex, metric);
    return rankPeriod(visible, metric);
  }, [visible, activeIndex, metric, domain]);
  const rankingTitle =
    activeIndex !== null && domain[activeIndex]
      ? `Classement — ${bucketTooltipLabel(domain[activeIndex], bucket)}`
      : `Classement — ${period.label}`;

  const conclusions = useMemo(() => buildConclusions(series, bucket), [series, bucket]);
  const aggregates = useMemo(
    () => series.map((s) => ({ ...s, agg: aggregate(s.points) })),
    [series],
  );

  const noSelection = isAdmin && storeIds.length === 0;

  return (
    <div className="pb-4">
      <PageHeader title="Comparaisons" subtitle="Multi-points de vente" />
      <div className="px-4 pt-3 space-y-3">
        {/* Barre de sélection : magasins + période + inverser + réinitialiser */}
        <div className="flex items-center gap-2 flex-wrap">
          {isAdmin ? <StorePickerButton /> : (
            <span className="text-xs font-semibold text-mobile-muted">Votre point de vente</span>
          )}
          <PeriodPicker />
          {isAdmin && storeIds.length === 2 && (
            <button
              onClick={() => sel.swap()}
              aria-label="Inverser A et B"
              className="p-1.5 rounded-full bg-mobile-card shadow-soft"
            >
              <ArrowLeftRight size={14} className="text-mobile-accent" />
            </button>
          )}
          {isAdmin && storeIds.length > 0 && (
            <button
              onClick={() => {
                sel.clear();
                setHighlightId(null);
                setActiveIndex(null);
              }}
              className="flex items-center gap-1 text-[11px] font-semibold text-mobile-muted"
            >
              <RotateCcw size={12} /> Réinitialiser
            </button>
          )}
        </div>

        {/* Qui est comparé — jamais besoin de deviner */}
        {series.length > 0 && (
          <div className="flex items-center flex-wrap gap-x-2 gap-y-1">
            {series.map((s, i) => (
              <span key={s.storeId} className="flex items-center gap-1.5">
                {i > 0 && <span className="text-[10px] font-black text-mobile-muted">VS</span>}
                <span className="text-sm font-bold" style={{ color: storeColor(s.storeId) }}>
                  {s.name}
                </span>
              </span>
            ))}
            {sel.showNetworkAvg && d?.network && (
              <span className="flex items-center gap-1.5">
                <span className="text-[10px] font-black text-mobile-muted">VS</span>
                <span className="text-sm font-bold" style={{ color: NETWORK_AVG_COLOR }}>moyenne réseau</span>
              </span>
            )}
          </div>
        )}

        <Segmented
          options={[
            { key: 'synthese' as View, label: 'Synthèse' },
            { key: 'detail' as View, label: 'Détail' },
            { key: 'produits' as View, label: 'Produits' },
            { key: 'periodes' as View, label: 'Périodes' },
          ]}
          value={view}
          onChange={setView}
        />

        {(view === 'synthese' || view === 'detail') && (
          <>
            {seriesReq.error && <ErrorBanner message={seriesReq.error} onRetry={seriesReq.reload} />}
            <SyncBadge
              syncedAt={seriesReq.syncedAt}
              fromCache={seriesReq.fromCache}
              onReload={seriesReq.reload}
              loading={seriesReq.loading}
            />
          </>
        )}

        {noSelection && view !== 'periodes' ? (
          <div className="bg-mobile-card rounded-2xl shadow-card p-4 text-center space-y-2">
            <p className="text-sm text-mobile-muted">
              Sélectionnez un ou plusieurs points de vente pour lancer la comparaison.
            </p>
            <StorePickerButton />
          </div>
        ) : null}

        {/* ── SYNTHÈSE ── */}
        {view === 'synthese' && !noSelection && (
          <>
            {seriesReq.loading && !d ? (
              <LoadingCards count={4} />
            ) : d ? (
              <>
                {/* Résumé tableau (2 côtés) ou cartes agrégées (N côtés) */}
                {aggregates.length === 2 ? (
                  <SummaryTable a={aggregates[0]} b={aggregates[1]} />
                ) : aggregates.length > 0 ? (
                  <div className="grid grid-cols-2 gap-2">
                    {aggregates.map((s) => (
                      <div key={s.storeId} className="bg-mobile-card rounded-2xl shadow-card p-3">
                        <p className="text-[11px] font-semibold truncate" style={{ color: storeColor(s.storeId) }}>{s.name}</p>
                        <p className="text-lg font-bold tabular-nums">{formatMoneyCompact(s.agg.revenue)}</p>
                        <p className="text-[10px] text-mobile-muted">
                          {formatInt(s.agg.tickets)} tickets · panier {s.agg.tickets ? formatMoney(Math.round(s.agg.revenue / s.agg.tickets)) : '—'}
                        </p>
                      </div>
                    ))}
                  </div>
                ) : null}

                {/* Conclusions factuelles */}
                {conclusions.length > 0 && (
                  <div className="bg-mobile-card rounded-2xl shadow-card p-3.5 space-y-1.5">
                    <p className="text-[10px] uppercase tracking-wide text-mobile-muted font-semibold">
                      Ce que montrent les chiffres
                    </p>
                    {conclusions.map((c) => (
                      <p key={c} className="text-sm text-mobile-text">• {c}</p>
                    ))}
                  </div>
                )}

                <MultiLineChart
                  labels={labels}
                  series={chartSeries}
                  activeIndex={activeIndex}
                  onIndexChange={setActiveIndex}
                  highlightId={highlightId}
                  onToggleHighlight={toggleHighlight}
                  formatValue={(v) => fmtFor('revenue')(v)}
                />
                <RankingTable
                  title={rankingTitle}
                  ranking={ranking}
                  metric={metric}
                  fmt={fmt}
                  networkAvgValue={avgAt(d, activeIndex, metric, sel.showNetworkAvg)}
                  onSelect={(id) => navigate(`/stores/${id}`)}
                />
              </>
            ) : null}
          </>
        )}

        {/* ── DÉTAIL ── */}
        {view === 'detail' && !noSelection && (
          <>
            <Segmented
              options={METRICS.map((m) => ({ key: m.key, label: m.label }))}
              value={metric}
              onChange={(m) => setMetric(m)}
            />
            {series.length > 5 && (
              <Segmented
                options={[
                  { key: 'all' as ChartMode, label: 'Toutes les courbes' },
                  { key: 'top5' as ChartMode, label: 'Top 5' },
                  { key: 'bottom5' as ChartMode, label: 'Bottom 5' },
                  { key: 'small' as ChartMode, label: 'Mini-graphiques' },
                ]}
                value={chartMode}
                onChange={setChartMode}
              />
            )}
            {seriesReq.loading && !d ? (
              <LoadingCards count={4} />
            ) : d ? (
              <>
                {metric === 'margin' && (
                  <p className="text-[11px] text-mobile-muted px-1">
                    Marge estimée sur le coût produit actuel — « — » quand aucun coût n'est renseigné.
                  </p>
                )}
                {chartMode === 'small' && series.length > 1 ? (
                  <SmallMultiples labels={labels} series={chartSeries.filter((s) => s.id !== '__avg__')} formatValue={(v) => fmt(v)} />
                ) : (
                  <MultiLineChart
                    labels={labels}
                    series={chartSeries}
                    activeIndex={activeIndex}
                    onIndexChange={setActiveIndex}
                    highlightId={highlightId}
                    onToggleHighlight={toggleHighlight}
                    formatValue={(v) => fmt(v)}
                  />
                )}
                <RankingTable
                  title={rankingTitle}
                  ranking={ranking}
                  metric={metric}
                  fmt={fmt}
                  networkAvgValue={avgAt(d, activeIndex, metric, sel.showNetworkAvg)}
                  onSelect={(id) => navigate(`/stores/${id}`)}
                />
                <HourProfile storeIds={storeIds} highlightId={highlightId} onToggleHighlight={toggleHighlight} />
              </>
            ) : null}
          </>
        )}

        {/* ── PRODUITS ── */}
        {view === 'produits' && !noSelection && (
          <ProductsMatrix storeIds={storeIds} onOpenProduct={(ean) => navigate(`/products/${encodeURIComponent(ean)}`)} />
        )}

        {/* ── PÉRIODES (A vs B sur le même périmètre) ── */}
        {view === 'periodes' && <PeriodCompare storeIds={storeIds} isAdmin={isAdmin} />}
      </div>
    </div>
  );
}

/** Valeur de la moyenne réseau au créneau actif (ou sur la période). */
function avgAt(d: any, activeIndex: number | null, metric: MetricKey, enabled: boolean): number | null {
  if (!enabled || !d?.network?.average) return null;
  if (!['revenue', 'tickets', 'avgTicket', 'discount'].includes(metric)) return null;
  if (activeIndex !== null && d.network.average[activeIndex]) {
    return metricValue(d.network.average[activeIndex], metric);
  }
  return metricValue(aggregate(d.network.average), metric);
}

// ── Résumé A vs B ────────────────────────────────────────────────

function SummaryTable({ a, b }: { a: StoreSeries & { agg: any }; b: StoreSeries & { agg: any } }) {
  const basket = (x: any) => (x.tickets ? Math.round(x.revenue / x.tickets) : null);
  const rows = [
    {
      label: "Chiffre d'affaires",
      a: formatMoneyCompact(a.agg.revenue),
      b: formatMoneyCompact(b.agg.revenue),
      delta: `${formatMoney(a.agg.revenue - b.agg.revenue)}${b.agg.revenue ? ` (${formatPct(Math.round(((a.agg.revenue - b.agg.revenue) / b.agg.revenue) * 1000) / 10)})` : ''}`,
      pct: b.agg.revenue ? Math.round(((a.agg.revenue - b.agg.revenue) / b.agg.revenue) * 1000) / 10 : null,
    },
    {
      label: 'Tickets',
      a: formatInt(a.agg.tickets),
      b: formatInt(b.agg.tickets),
      delta: `${a.agg.tickets - b.agg.tickets >= 0 ? '+' : ''}${formatInt(a.agg.tickets - b.agg.tickets)}`,
      pct: b.agg.tickets ? Math.round(((a.agg.tickets - b.agg.tickets) / b.agg.tickets) * 1000) / 10 : null,
    },
    {
      label: 'Panier moyen',
      a: formatMoney(basket(a.agg)),
      b: formatMoney(basket(b.agg)),
      delta: basket(a.agg) !== null && basket(b.agg) !== null ? formatMoney(basket(a.agg)! - basket(b.agg)!) : '—',
      pct: null,
    },
    {
      label: 'Articles vendus',
      a: formatInt(a.agg.items),
      b: formatInt(b.agg.items),
      delta: `${a.agg.items - b.agg.items >= 0 ? '+' : ''}${formatInt(a.agg.items - b.agg.items)}`,
      pct: null,
    },
    {
      label: 'Remboursements',
      a: formatInt(a.agg.refunds),
      b: formatInt(b.agg.refunds),
      delta: `${a.agg.refunds - b.agg.refunds >= 0 ? '+' : ''}${formatInt(a.agg.refunds - b.agg.refunds)}`,
      pct: null,
    },
    {
      label: 'Remises',
      a: formatMoneyCompact(a.agg.discount),
      b: formatMoneyCompact(b.agg.discount),
      delta: formatMoney(a.agg.discount - b.agg.discount),
      pct: null,
    },
  ];
  return (
    <div className="bg-mobile-card rounded-2xl shadow-card overflow-hidden">
      <div className="grid grid-cols-[1.1fr_1fr_1fr] px-3.5 pt-3 pb-1.5 text-[11px] font-bold uppercase tracking-wide">
        <span className="text-mobile-muted">Indicateur</span>
        <span className="text-right truncate" style={{ color: storeColor(a.storeId) }}>{a.name}</span>
        <span className="text-right truncate" style={{ color: storeColor(b.storeId) }}>{b.name}</span>
      </div>
      <div className="divide-y divide-mobile-border/50">
        {rows.map((r) => (
          <div key={r.label} className="px-3.5 py-2.5">
            <div className="grid grid-cols-[1.1fr_1fr_1fr] items-center">
              <span className="text-xs font-semibold">{r.label}</span>
              <span className="text-sm font-bold tabular-nums text-right">{r.a}</span>
              <span className="text-sm tabular-nums text-right text-mobile-muted">{r.b}</span>
            </div>
            <div className="flex justify-end items-center gap-2 mt-0.5">
              {r.pct !== null && <DeltaBadge pct={r.pct} />}
              <span className="text-[11px] text-mobile-muted">écart : {r.delta}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Classement synchronisé au créneau ────────────────────────────

function RankingTable({ title, ranking, metric, fmt, networkAvgValue, onSelect }: {
  title: string;
  ranking: Array<{ storeId: string; name: string; value: number | null; point: any }>;
  metric: MetricKey;
  fmt: (v: number | null) => string;
  networkAvgValue: number | null;
  onSelect: (id: string) => void;
}) {
  if (!ranking.length) return null;
  const first = ranking[0]?.value ?? null;
  const last = ranking[ranking.length - 1]?.value ?? null;
  return (
    <div className="bg-mobile-card rounded-2xl shadow-card overflow-hidden">
      <p className="px-3.5 pt-3 pb-1 text-[11px] font-bold uppercase tracking-wide text-mobile-text">{title}</p>
      <div className="divide-y divide-mobile-border/50">
        {ranking.map((r, i) => (
          <button
            key={r.storeId}
            onClick={() => onSelect(r.storeId)}
            className="w-full flex items-center gap-2.5 px-3.5 py-2 text-left active:bg-mobile-subtle"
          >
            <span className="text-[11px] font-bold text-mobile-muted w-4 tabular-nums">{i + 1}</span>
            <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: storeColor(r.storeId) }} />
            <span className="flex-1 text-sm font-semibold truncate">{r.name}</span>
            {metric !== 'avgTicket' && r.point?.tickets !== undefined && (
              <span className="text-[10px] text-mobile-muted shrink-0">{formatInt(r.point.tickets)} tk</span>
            )}
            <span className="text-sm font-bold tabular-nums shrink-0">{fmt(r.value)}</span>
          </button>
        ))}
      </div>
      <div className="px-3.5 py-2 text-[11px] text-mobile-muted border-t border-mobile-border/50 space-y-0.5">
        {ranking.length > 1 && first !== null && last !== null && (
          <p>Écart 1ᵉʳ → dernier : <span className="font-semibold text-mobile-text">{fmt(first - last)}</span></p>
        )}
        {networkAvgValue !== null && (
          <p>Moyenne réseau : <span className="font-semibold text-mobile-text">{fmt(networkAvgValue)}</span></p>
        )}
      </div>
    </div>
  );
}

// ── Profil heure par heure (agrégé sur la période, ≤ 14 jours) ───

function HourProfile({ storeIds, highlightId, onToggleHighlight }: {
  storeIds: string[];
  highlightId: string | null;
  onToggleHighlight: (id: string) => void;
}) {
  const period = useCurrentPeriodParams();
  const [idx, setIdx] = useState<number | null>(null);
  const spanDays = (new Date(period.to).getTime() - new Date(period.from).getTime()) / 86400000;
  const enabled = spanDays > 1.01 && spanDays <= 14 && storeIds.length > 0;

  const req = useApi(
    `series-hour:${period.from}:${period.to}:${storeIds.join(',')}`,
    () =>
      analyticsApi.series({
        from: period.from,
        to: period.to,
        tz: period.tz,
        storeIds: storeIds.join(','),
        bucket: 'hour',
      }),
    [period.from, period.to, storeIds.join(','), enabled],
    enabled,
  );
  if (!enabled) return null;
  const d: any = req.data;
  if (req.loading && !d) return null;
  if (!d) return null;

  // Agrège par heure de la journée (0-23) sur toute la période.
  const hours = Array.from(new Set((d.domain as string[]).map((t) => Number(t.split(' ')[1].split(':')[0])))).sort((a, b) => a - b);
  const chartSeries: ChartSeries[] = d.series.map((s: any) => {
    const byHour = new Map<number, number>();
    s.points.forEach((p: any, i: number) => {
      const h = Number((d.domain[i] as string).split(' ')[1].split(':')[0]);
      byHour.set(h, (byHour.get(h) ?? 0) + p.revenue);
    });
    return {
      id: s.storeId,
      name: s.name,
      color: storeColor(s.storeId),
      values: hours.map((h) => byHour.get(h) ?? 0),
    };
  });

  return (
    <div className="space-y-1.5">
      <p className="text-[11px] font-bold uppercase tracking-wide text-mobile-text px-1">
        Profil heure par heure (cumul de la période)
      </p>
      <MultiLineChart
        labels={hours.map((h) => `${h} h`)}
        series={chartSeries}
        activeIndex={idx}
        onIndexChange={setIdx}
        highlightId={highlightId}
        onToggleHighlight={onToggleHighlight}
        formatValue={(v) => formatMoneyCompact(v)}
      />
    </div>
  );
}

// ── Matrice produits × magasins ──────────────────────────────────

function ProductsMatrix({ storeIds, onOpenProduct }: { storeIds: string[]; onOpenProduct: (ean: string) => void }) {
  const period = useCurrentPeriodParams();
  const [sortStoreId, setSortStoreId] = useState<string | null>(null);
  const req = useApi(
    `matrix:${period.from}:${period.to}:${storeIds.join(',')}:${sortStoreId ?? 'total'}`,
    () =>
      analyticsApi.productsMatrix({
        from: period.from,
        to: period.to,
        storeIds: storeIds.join(','),
        sortStoreId: sortStoreId ?? undefined,
      }),
    [period.from, period.to, storeIds.join(','), sortStoreId],
    storeIds.length > 0,
  );
  const d: any = req.data;

  const insights = useMemo(() => {
    if (!d?.products?.length || d.stores.length < 2) return null;
    const nameBy = new Map(d.stores.map((s: any) => [s.storeId, s.name]));
    const topPerStore = d.stores.map((s: any) => {
      const best = d.products
        .filter((p: any) => p.perStore[s.storeId])
        .sort((a: any, b: any) => (a.perStore[s.storeId]?.rank ?? 99) - (b.perStore[s.storeId]?.rank ?? 99))[0];
      return { store: s.name, product: best?.name ?? null, ean: best?.ean ?? null };
    });
    const exclusives = d.products
      .filter((p: any) => Object.values(p.perStore).filter(Boolean).length === 1)
      .map((p: any) => {
        const only = Object.entries(p.perStore).find(([, v]) => v)?.[0];
        return { name: p.name, ean: p.ean, store: nameBy.get(only!) };
      });
    const contrasts = d.products
      .map((p: any) => {
        const cells = Object.entries(p.perStore).filter(([, v]) => v) as Array<[string, any]>;
        if (cells.length < 2) return null;
        const sorted = [...cells].sort((a, b) => a[1].rank - b[1].rank);
        const best = sorted[0];
        const worst = sorted[sorted.length - 1];
        if (best[1].rank <= 2 && worst[1].rank - best[1].rank >= 3) {
          return { name: p.name, ean: p.ean, strongIn: nameBy.get(best[0]), weakIn: nameBy.get(worst[0]), bestRank: best[1].rank, worstRank: worst[1].rank };
        }
        return null;
      })
      .filter(Boolean);
    return { topPerStore, exclusives, contrasts };
  }, [d]);

  return (
    <>
      {req.error && <ErrorBanner message={req.error} onRetry={req.reload} />}
      <SyncBadge syncedAt={req.syncedAt} fromCache={req.fromCache} onReload={req.reload} loading={req.loading} />
      {req.loading && !d ? (
        <LoadingCards count={3} />
      ) : d?.products?.length ? (
        <>
          {/* Matrice — première colonne figée, tri par magasin au toucher de l'en-tête */}
          <div className="bg-mobile-card rounded-2xl shadow-card overflow-x-auto">
            <table className="w-full text-sm" style={{ minWidth: 120 + d.stores.length * 84 + 70 }}>
              <thead>
                <tr className="text-[10px] uppercase tracking-wide text-mobile-muted">
                  <th className="sticky left-0 bg-mobile-card text-left px-3 py-2 font-semibold">
                    Produit <span className="normal-case font-normal">(quantités)</span>
                  </th>
                  {d.stores.map((s: any) => (
                    <th key={s.storeId} className="px-2 py-2 text-right">
                      <button
                        onClick={() => setSortStoreId(sortStoreId === s.storeId ? null : s.storeId)}
                        className={`font-semibold ${sortStoreId === s.storeId ? 'underline' : ''}`}
                        style={{ color: storeColor(s.storeId) }}
                      >
                        {s.name.replace(/^Wesley /, '')}
                      </button>
                    </th>
                  ))}
                  <th className="px-2 py-2 text-right font-semibold">Réseau</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-mobile-border/40">
                {d.products.map((p: any) => (
                  <tr key={p.ean} onClick={() => onOpenProduct(p.ean)} className="active:bg-mobile-subtle cursor-pointer">
                    <td className="sticky left-0 bg-mobile-card px-3 py-2 font-semibold text-xs max-w-[130px] truncate">{p.name}</td>
                    {d.stores.map((s: any) => {
                      const c = p.perStore[s.storeId];
                      return (
                        <td key={s.storeId} className="px-2 py-2 text-right tabular-nums">
                          {c ? (
                            <>
                              <span className="font-bold">{formatInt(c.quantity)}</span>
                              <span className="block text-[9px] text-mobile-muted">
                                {c.rank}ᵉ · {formatMoneyCompact(c.revenueMinorUnits)}
                              </span>
                            </>
                          ) : (
                            <span className="text-mobile-muted text-xs">—</span>
                          )}
                        </td>
                      );
                    })}
                    <td className="px-2 py-2 text-right tabular-nums text-mobile-muted">
                      {p.network ? formatInt(p.network.qty) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-[10px] text-mobile-muted px-1">
            Touchez un en-tête de magasin pour trier la matrice · touchez un produit pour ouvrir sa fiche ·
            « — » = aucune vente dans ce magasin sur la période.
          </p>

          {/* Lectures dérivées de la matrice */}
          {insights && (
            <div className="space-y-2">
              <div className="bg-mobile-card rounded-2xl shadow-card p-3.5 space-y-1">
                <p className="text-[10px] uppercase tracking-wide text-mobile-muted font-semibold">Nᵒ 1 par magasin</p>
                {insights.topPerStore.map((t: any) => (
                  <p key={t.store} className="text-xs">
                    <span className="font-semibold">{t.store}</span> :{' '}
                    {t.product ? (
                      <button className="text-mobile-accent font-semibold" onClick={() => onOpenProduct(t.ean)}>{t.product}</button>
                    ) : 'aucune vente'}
                  </p>
                ))}
              </div>
              {insights.contrasts.length > 0 && (
                <div className="bg-mobile-card rounded-2xl shadow-card p-3.5 space-y-1">
                  <p className="text-[10px] uppercase tracking-wide text-mobile-muted font-semibold">Fort ici, faible là</p>
                  {insights.contrasts.map((c: any) => (
                    <p key={c.ean} className="text-xs">
                      <button className="font-semibold text-mobile-accent" onClick={() => onOpenProduct(c.ean)}>{c.name}</button>
                      {' '}: {c.bestRank}ᵉ à {c.strongIn}, {c.worstRank}ᵉ à {c.weakIn}
                    </p>
                  ))}
                </div>
              )}
              {insights.exclusives.length > 0 && (
                <div className="bg-mobile-card rounded-2xl shadow-card p-3.5 space-y-1">
                  <p className="text-[10px] uppercase tracking-wide text-mobile-muted font-semibold">Vendus dans un seul magasin</p>
                  {insights.exclusives.map((e: any) => (
                    <p key={e.ean} className="text-xs">
                      <button className="font-semibold text-mobile-accent" onClick={() => onOpenProduct(e.ean)}>{e.name}</button>
                      {' '}— uniquement à {e.store}
                    </p>
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      ) : d ? (
        <Unavailable label="Aucune vente sur la période pour la sélection" />
      ) : null}
    </>
  );
}

// ── Comparaison de périodes (A vs B, même périmètre) ─────────────

type PresetKey =
  | 'today_vs_yesterday'
  | 'today_vs_same_dow_last_week'
  | 'today_vs_same_day_last_year'
  | 'week_vs_last_week'
  | 'month_vs_last_month'
  | 'semester_vs_last'
  | 'year_vs_last'
  | 'periods';

const PRESETS: Array<{ key: PresetKey; label: string }> = [
  { key: 'today_vs_yesterday', label: "Aujourd'hui vs hier" },
  { key: 'today_vs_same_dow_last_week', label: 'Vs même jour S-1' },
  { key: 'today_vs_same_day_last_year', label: 'Vs même jour N-1' },
  { key: 'week_vs_last_week', label: 'Semaine vs S-1' },
  { key: 'month_vs_last_month', label: 'Mois vs M-1' },
  { key: 'semester_vs_last', label: 'Semestre vs S-1' },
  { key: 'year_vs_last', label: 'Année vs N-1' },
  { key: 'periods', label: 'Périodes au choix' },
];

function presetWindows(key: PresetKey, aKey: PeriodKey, bKey: PeriodKey) {
  const now = new Date();
  const day = (offsetDays: number) => {
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offsetDays);
    const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offsetDays + 1);
    return { from: start, to: end };
  };
  switch (key) {
    case 'today_vs_yesterday':
      return { a: day(0), b: day(-1), aLabel: "Aujourd'hui", bLabel: 'Hier' };
    case 'today_vs_same_dow_last_week':
      return { a: day(0), b: day(-7), aLabel: "Aujourd'hui", bLabel: 'Même jour S-1' };
    case 'today_vs_same_day_last_year': {
      const b = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate());
      return {
        a: day(0),
        b: { from: b, to: new Date(b.getFullYear(), b.getMonth(), b.getDate() + 1) },
        aLabel: "Aujourd'hui",
        bLabel: 'Même date N-1',
      };
    }
    case 'week_vs_last_week':
      return { a: periodWindow('this_week', now), b: periodWindow('last_week', now), aLabel: 'Cette semaine', bLabel: 'Semaine préc.' };
    case 'month_vs_last_month':
      return { a: periodWindow('this_month', now), b: periodWindow('last_month', now), aLabel: 'Ce mois', bLabel: 'Mois préc.' };
    case 'semester_vs_last':
      return { a: periodWindow('this_semester', now), b: periodWindow('last_semester', now), aLabel: 'Ce semestre', bLabel: 'Semestre préc.' };
    case 'year_vs_last':
      return { a: periodWindow('this_year', now), b: periodWindow('last_year', now), aLabel: 'Cette année', bLabel: 'Année préc.' };
    case 'periods':
      return {
        a: periodWindow(aKey, now),
        b: periodWindow(bKey, now),
        aLabel: PERIOD_LABELS[aKey],
        bLabel: PERIOD_LABELS[bKey],
      };
  }
}

/** Taux (pas un delta) : sans signe +. */
const rate = (pct: number | null) =>
  pct === null ? '—' : `${pct.toLocaleString('fr-FR', { maximumFractionDigits: 1 })} %`;

const NETWORK = '__network__';

function PeriodCompare({ storeIds, isAdmin }: { storeIds: string[]; isAdmin: boolean }) {
  const [preset, setPreset] = useState<PresetKey>('today_vs_yesterday');
  const [aKey, setAKey] = useState<PeriodKey>('this_month');
  const [bKey, setBKey] = useState<PeriodKey>('last_month');
  const [scope, setScope] = useState<string>(isAdmin ? NETWORK : storeIds[0] ?? NETWORK);
  const { stores } = useNetworkScopeOptions(isAdmin);

  const wins = useMemo(() => presetWindows(preset, aKey, bKey), [preset, aKey, bKey]);
  const aP = periodParams(wins.a);
  const bP = periodParams(wins.b);
  const scopeStore = scope === NETWORK ? undefined : scope;

  const cmp = useApi(
    `compare:${aP.from}:${aP.to}:${bP.from}:${bP.to}:${scope}`,
    () =>
      analyticsApi.compare({
        aFrom: aP.from,
        aTo: aP.to,
        bFrom: bP.from,
        bTo: bP.to,
        storeA: scopeStore,
        storeB: scopeStore,
        tz: aP.tz,
      }),
    [aP.from, aP.to, bP.from, bP.to, scope],
  );
  const d: any = cmp.data;

  const rows = d
    ? [
        { label: "Chiffre d'affaires", a: formatMoneyCompact(d.a.kpis.revenueMinorUnits), b: formatMoneyCompact(d.b.kpis.revenueMinorUnits), delta: `${formatMoney(d.delta.revenueDeltaMinorUnits)} (${formatPct(d.delta.revenueDeltaPct)})`, pct: d.delta.revenueDeltaPct },
        { label: 'Tickets', a: formatInt(d.a.kpis.tickets), b: formatInt(d.b.kpis.tickets), delta: `${d.delta.ticketsDelta >= 0 ? '+' : ''}${formatInt(d.delta.ticketsDelta)} (${formatPct(d.delta.ticketsDeltaPct)})`, pct: d.delta.ticketsDeltaPct },
        { label: 'Panier moyen', a: formatMoney(d.a.kpis.avgTicketMinorUnits), b: formatMoney(d.b.kpis.avgTicketMinorUnits), delta: d.delta.avgTicketDeltaMinorUnits === null ? '—' : formatMoney(d.delta.avgTicketDeltaMinorUnits), pct: null },
        { label: 'Articles vendus', a: formatInt(d.a.kpis.itemsSold), b: formatInt(d.b.kpis.itemsSold), delta: `${d.delta.itemsDelta >= 0 ? '+' : ''}${formatInt(d.delta.itemsDelta)}`, pct: null },
        { label: 'Taux de remise', a: rate(d.a.kpis.discountRatePct), b: rate(d.b.kpis.discountRatePct), delta: d.delta.discountRateDeltaPts === null ? '—' : `${d.delta.discountRateDeltaPts >= 0 ? '+' : ''}${d.delta.discountRateDeltaPts} pt`, pct: null },
        { label: 'Remboursements', a: formatInt(d.a.kpis.refunds.count), b: formatInt(d.b.kpis.refunds.count), delta: `${d.delta.refundCountDelta >= 0 ? '+' : ''}${formatInt(d.delta.refundCountDelta)}`, pct: null },
      ]
    : [];

  const periodOptions = (Object.keys(PERIOD_LABELS) as PeriodKey[])
    .filter((k) => k !== 'custom')
    .map((k) => ({ key: k, label: PERIOD_LABELS[k] }));

  const [hIdx, setHIdx] = useState<number | null>(null);
  const [dIdx, setDIdx] = useState<number | null>(null);

  return (
    <div className="space-y-3">
      <p className="text-[11px] text-mobile-muted px-1">
        Compare le même périmètre sur deux périodes (ex. un magasin avec lui-même).
      </p>
      <Segmented options={PRESETS} value={preset} onChange={setPreset} />
      {preset === 'periods' && (
        <div className="grid grid-cols-2 gap-2">
          {[
            { label: 'Période A', v: aKey, set: setAKey },
            { label: 'Période B', v: bKey, set: setBKey },
          ].map((side) => (
            <label key={side.label} className="text-[11px] text-mobile-muted">
              {side.label}
              <select
                value={side.v}
                onChange={(e) => side.set(e.target.value as PeriodKey)}
                className="mt-0.5 w-full px-2 py-2 rounded-xl border border-mobile-border bg-white text-sm"
              >
                {periodOptions.map((o) => (
                  <option key={o.key} value={o.key}>{o.label}</option>
                ))}
              </select>
            </label>
          ))}
        </div>
      )}
      {isAdmin && (
        <label className="block text-[11px] text-mobile-muted">
          Périmètre
          <select
            value={scope}
            onChange={(e) => setScope(e.target.value)}
            className="mt-0.5 w-full px-2 py-2 rounded-xl border border-mobile-border bg-white text-sm"
          >
            <option value={NETWORK}>Réseau entier</option>
            {stores.map((s: any) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </label>
      )}

      {cmp.error && <ErrorBanner message={cmp.error} onRetry={cmp.reload} />}
      <SyncBadge syncedAt={cmp.syncedAt} fromCache={cmp.fromCache} onReload={cmp.reload} loading={cmp.loading} />

      {cmp.loading && !d ? (
        <LoadingCards count={4} />
      ) : d ? (
        <>
          <div className="bg-mobile-card rounded-2xl shadow-card overflow-hidden">
            <div className="grid grid-cols-[1.2fr_1fr_1fr] text-[11px] font-bold text-mobile-muted uppercase tracking-wide px-3.5 pt-3 pb-1.5">
              <span />
              <span className="text-right text-mobile-accent">{wins.aLabel}</span>
              <span className="text-right">{wins.bLabel}</span>
            </div>
            <div className="divide-y divide-mobile-border/50">
              {rows.map((r) => (
                <div key={r.label} className="px-3.5 py-2.5">
                  <div className="grid grid-cols-[1.2fr_1fr_1fr] items-center">
                    <span className="text-xs font-semibold text-mobile-text">{r.label}</span>
                    <span className="text-sm font-bold tabular-nums text-right">{r.a}</span>
                    <span className="text-sm tabular-nums text-right text-mobile-muted">{r.b}</span>
                  </div>
                  <div className="flex justify-end mt-0.5 items-center gap-2">
                    {r.pct !== null && <DeltaBadge pct={r.pct} />}
                    <span className="text-[11px] text-mobile-muted">écart : {r.delta}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Heure par heure — interactif, légende nommée */}
          <p className="text-[11px] font-bold text-mobile-text uppercase tracking-wide px-1">Heure par heure</p>
          <MultiLineChart
            labels={d.a.hourly.map((p: any) => `${p.hour} h`)}
            series={[
              { id: 'A', name: wins.aLabel, color: '#7c3aed', values: d.a.hourly.map((p: any) => p.revenueMinorUnits) },
              { id: 'B', name: wins.bLabel, color: NETWORK_AVG_COLOR, dashed: true, values: d.b.hourly.map((p: any) => p.revenueMinorUnits) },
            ]}
            activeIndex={hIdx}
            onIndexChange={setHIdx}
            highlightId={null}
            onToggleHighlight={() => {}}
            formatValue={(v) => formatMoneyCompact(v)}
          />

          {/* Jour par jour (masqué si période d'un seul jour → carte compacte) */}
          {d.a.dailySeries.length > 1 ? (
            <>
              <p className="text-[11px] font-bold text-mobile-text uppercase tracking-wide px-1">Jour par jour</p>
              <MultiLineChart
                labels={d.a.dailySeries.map((p: any) => bucketLabel(`${p.date} 00:00`, 'day'))}
                series={[
                  { id: 'A', name: wins.aLabel, color: '#7c3aed', values: d.a.dailySeries.map((p: any) => p.revenueMinorUnits) },
                  { id: 'B', name: wins.bLabel, color: NETWORK_AVG_COLOR, dashed: true, values: d.b.dailySeries.map((p: any) => p.revenueMinorUnits) },
                ]}
                activeIndex={dIdx}
                onIndexChange={setDIdx}
                highlightId={null}
                onToggleHighlight={() => {}}
                formatValue={(v) => formatMoneyCompact(v)}
              />
            </>
          ) : (
            <div className="bg-mobile-card rounded-2xl shadow-card p-3.5">
              <p className="text-[11px] text-mobile-muted">Période d'un seul jour — résultat du jour :</p>
              <p className="text-lg font-bold tabular-nums">
                {formatMoneyCompact(d.a.kpis.revenueMinorUnits)}
                <span className="text-sm text-mobile-muted font-medium"> vs {formatMoneyCompact(d.b.kpis.revenueMinorUnits)}</span>
              </p>
              <p className="text-[11px] text-mobile-muted">Le détail heure par heure est affiché ci-dessus.</p>
            </div>
          )}
        </>
      ) : null}
    </div>
  );
}

function useNetworkScopeOptions(isAdmin: boolean) {
  const req = useApi('stores-accessible', () => storesApi.accessible(), [isAdmin]);
  return { stores: Array.isArray(req.data) ? (req.data as any[]) : [] };
}
