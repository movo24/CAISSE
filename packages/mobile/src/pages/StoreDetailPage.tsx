// ── Fiche point de vente (lecture seule) ─────────────────────────
// CA multi-fenêtres, comparaisons P-1/N-1, séries jour & heure,
// top/flop produits, catégories, remises, avoirs, annulations,
// ruptures actuelles, rang réseau et son évolution.
// ─────────────────────────────────────────────────────────────────

import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, GitCompareArrows } from 'lucide-react';
import { analyticsApi } from '../services/api';
import { useSelectionStore } from '../stores/selectionStore';
import { useApi } from '../hooks/useApi';
import { PeriodPicker, useCurrentPeriodParams } from '../components/PeriodPicker';
import {
  DeltaBadge, ErrorBanner, KpiCard, LoadingCards, PageHeader, Section, SyncBadge,
} from '../components/ui';
import { BarList, LineChart } from '../components/charts';
import {
  formatHour, formatInt, formatMoney, formatMoneyCompact, UNAVAILABLE,
} from '../lib/format';

export function StoreDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const setSelection = useSelectionStore((st) => st.setAll);
  const period = useCurrentPeriodParams();

  const detail = useApi(
    `store:${id}:${period.from}:${period.to}`,
    () => analyticsApi.storeDetail(id!, { from: period.from, to: period.to, tz: period.tz }),
    [id, period.from, period.to],
  );
  const windows = useApi(
    `store-windows:${id}`,
    () => analyticsApi.revenueWindows({ storeId: id, tz: period.tz }),
    [id],
  );

  const d: any = detail.data;
  const w: any = windows.data;
  const currency = d?.store?.currencyCode ?? 'EUR';

  const hourlySorted = d ? [...d.hourly].sort((a: any, b: any) => b.revenueMinorUnits - a.revenueMinorUnits) : [];
  const bestHours = hourlySorted.slice(0, 3);
  const weakHours = hourlySorted.length > 3 ? hourlySorted.slice(-3).reverse() : [];

  return (
    <div className="pb-4">
      <PageHeader
        title={d?.store?.name ?? 'Point de vente'}
        subtitle={d?.store?.city ?? undefined}
        right={
          <button onClick={() => navigate(-1)} aria-label="Retour" className="p-2 rounded-xl active:bg-mobile-subtle">
            <ArrowLeft size={19} className="text-mobile-muted" />
          </button>
        }
      />

      <div className="px-4 pt-3 space-y-4">
        <PeriodPicker />
        {detail.error && <ErrorBanner message={detail.error} onRetry={detail.reload} />}
        <SyncBadge syncedAt={detail.syncedAt} fromCache={detail.fromCache} onReload={detail.reload} loading={detail.loading} />

        {detail.loading && !d ? (
          <LoadingCards count={6} />
        ) : d ? (
          <>
            {/* Rang réseau */}
            <div className="bg-mobile-card rounded-2xl shadow-card p-3.5 flex items-center justify-between">
              <div>
                <p className="text-[11px] text-mobile-muted">Classement réseau ({period.label})</p>
                <p className="text-lg font-bold">
                  {d.networkRank ? `${d.networkRank.position}ᵉ / ${d.networkRank.total}` : UNAVAILABLE}
                </p>
              </div>
              {d.networkRank && d.previousNetworkRank && (
                <span className={`text-xs font-semibold px-2 py-1 rounded-lg ${
                  d.previousNetworkRank.position > d.networkRank.position
                    ? 'bg-emerald-50 text-emerald-700'
                    : d.previousNetworkRank.position < d.networkRank.position
                      ? 'bg-red-50 text-red-600'
                      : 'bg-mobile-subtle text-mobile-muted'
                }`}>
                  {d.previousNetworkRank.position > d.networkRank.position ? '↑' : d.previousNetworkRank.position < d.networkRank.position ? '↓' : '='}
                  {' '}était {d.previousNetworkRank.position}ᵉ
                </span>
              )}
            </div>

            {/* Comparer ce point de vente : il devient la base de la comparaison */}
            <button
              onClick={() => {
                if (id) setSelection([id]);
                navigate('/compare');
              }}
              className="w-full flex items-center justify-center gap-2 py-2.5 rounded-2xl bg-mobile-accent text-white text-sm font-bold"
            >
              <GitCompareArrows size={16} /> Comparer ce point de vente
            </button>

            {/* CA fenêtres calendaires */}
            {w && (
              <Section title="Chiffre d'affaires">
                <div className="grid grid-cols-3 gap-2">
                  <KpiCard label="Jour" value={formatMoneyCompact(w.todayMinorUnits, currency)} />
                  <KpiCard label="Semaine" value={formatMoneyCompact(w.weekMinorUnits, currency)} />
                  <KpiCard label="Mois" value={formatMoneyCompact(w.monthMinorUnits, currency)} />
                  <KpiCard label="Semestre" value={formatMoneyCompact(w.semesterMinorUnits, currency)} />
                  <KpiCard label="Année" value={formatMoneyCompact(w.yearMinorUnits, currency)} />
                  <KpiCard label="Hier" value={formatMoneyCompact(w.yesterdayMinorUnits, currency)} />
                </div>
              </Section>
            )}

            {/* KPIs période */}
            <Section title={`Période : ${period.label}`}>
              <div className="grid grid-cols-2 gap-3">
                <KpiCard
                  big
                  label="CA"
                  value={formatMoneyCompact(d.kpis.revenueMinorUnits, currency)}
                  delta={d.previousPeriod?.revenueGrowthPct}
                  hint="vs période préc."
                />
                <KpiCard
                  label="vs N-1"
                  value={formatMoneyCompact(d.yearAgo?.kpis?.revenueMinorUnits, currency)}
                  delta={d.yearAgo?.revenueGrowthPct}
                />
                <KpiCard label="Tickets" value={formatInt(d.kpis.tickets)} />
                <KpiCard label="Panier moyen" value={formatMoney(d.kpis.avgTicketMinorUnits, currency)} />
                <KpiCard label="Articles" value={formatInt(d.kpis.itemsSold)} />
                <KpiCard label="Taux de remise" value={d.kpis.discountRatePct === null ? '—' : `${d.kpis.discountRatePct.toLocaleString('fr-FR')} %`} />
                <KpiCard
                  label="Remboursements"
                  value={formatInt(d.kpis.refunds.count)}
                  hint={formatMoneyCompact(d.kpis.refunds.amountMinorUnits, currency)}
                />
                <KpiCard label="Annulations" value={formatInt(d.kpis.cancellations)} />
                <KpiCard label="Ruptures actuelles" value={formatInt(d.currentStockouts)} hint="produits à stock 0" />
                <KpiCard
                  label="Meilleure journée"
                  value={d.bestDay ? new Date(d.bestDay.date).toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' }) : UNAVAILABLE}
                  hint={d.bestDay ? formatMoneyCompact(d.bestDay.revenueMinorUnits, currency) : undefined}
                />
              </div>
            </Section>

            {/* Évolution CA */}
            <Section title="Évolution du CA">
              <LineChart
                currency={currency}
                points={d.dailySeries.map((p: any) => ({
                  label: new Date(p.date).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }),
                  value: p.revenueMinorUnits,
                }))}
              />
            </Section>

            {/* Heures fortes / faibles */}
            <Section title="Ventes par heure">
              {d.hourly.length ? (
                <div className="bg-mobile-card rounded-2xl shadow-card p-3.5 space-y-2">
                  <div className="flex gap-1 items-end h-20">
                    {d.hourly.map((h: any) => {
                      const max = Math.max(...d.hourly.map((x: any) => x.revenueMinorUnits), 1);
                      return (
                        <div key={h.hour} className="flex-1 h-full flex flex-col items-center justify-end gap-0.5">
                          <div
                            className="w-full rounded-t bg-mobile-accent/70"
                            style={{ height: `${Math.max((h.revenueMinorUnits / max) * 100, 3)}%` }}
                            title={`${h.hour}h — ${formatMoneyCompact(h.revenueMinorUnits, currency)}`}
                          />
                          <span className="text-[8px] text-mobile-muted">{h.hour}</span>
                        </div>
                      );
                    })}
                  </div>
                  <p className="text-[11px] text-mobile-muted">
                    Fortes : <span className="font-semibold text-mobile-text">{bestHours.map((h: any) => formatHour(h.hour)).join(', ') || '—'}</span>
                    {weakHours.length > 0 && (
                      <> · Faibles : <span className="font-semibold">{weakHours.map((h: any) => formatHour(h.hour)).join(', ')}</span></>
                    )}
                  </p>
                </div>
              ) : (
                <p className="text-center text-xs text-mobile-muted py-4">Aucune vente sur la période</p>
              )}
            </Section>

            {/* Top / flop produits */}
            <Section title="Produits les plus vendus">
              <BarList
                valueLabel="Quantité vendue"
                rows={d.topProducts.map((p: any) => ({
                  id: p.ean,
                  label: p.name,
                  sub: formatMoneyCompact(p.revenueMinorUnits, currency),
                  value: p.quantity,
                  display: formatInt(p.quantity),
                }))}
                onSelect={(ean) => navigate(`/products/${encodeURIComponent(ean)}`)}
              />
            </Section>
            {d.flopProducts.length > 0 && (
              <Section title="Produits les moins vendus">
                <BarList
                  rows={d.flopProducts.map((p: any) => ({
                    id: p.ean,
                    label: p.name,
                    sub: formatMoneyCompact(p.revenueMinorUnits, currency),
                    value: p.quantity,
                    display: formatInt(p.quantity),
                  }))}
                  onSelect={(ean) => navigate(`/products/${encodeURIComponent(ean)}`)}
                />
              </Section>
            )}

            {/* Catégories */}
            <Section title="Catégories">
              {d.categories.length ? (
                <div className="bg-mobile-card rounded-2xl shadow-card divide-y divide-mobile-border/50">
                  {d.categories.map((c: any) => (
                    <div key={c.category} className="px-3.5 py-2.5 flex items-center gap-3">
                      <span className="flex-1 min-w-0">
                        <span className="block text-sm font-semibold truncate">{c.category}</span>
                        <span className="block text-[11px] text-mobile-muted">{formatInt(c.quantity)} articles</span>
                      </span>
                      <span className="text-sm font-bold tabular-nums">{formatMoneyCompact(c.revenueMinorUnits, currency)}</span>
                      <DeltaBadge pct={c.growthPct} />
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-center text-xs text-mobile-muted py-4">Aucune donnée sur la période</p>
              )}
            </Section>
          </>
        ) : null}
      </div>
    </div>
  );
}
