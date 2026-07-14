// ── Fiche produit (agrégée par EAN, lecture seule) ───────────────
// Identité, ventes réelles (qté, CA, tickets, panier moyen des
// tickets contenant le produit), évolution vs période précédente,
// répartition par magasin / jour / heure / jour de semaine,
// co-achats, rang dans sa catégorie, variantes, stock en consultation.
// Historique des ruptures : aucune table d'historique → indisponible.
// ─────────────────────────────────────────────────────────────────

import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Barcode } from 'lucide-react';
import { analyticsApi } from '../services/api';
import { useApi } from '../hooks/useApi';
import { PeriodPicker, useCurrentPeriodParams } from '../components/PeriodPicker';
import {
  ErrorBanner, KpiCard, LoadingCards, PageHeader, Section, SyncBadge,
} from '../components/ui';
import { BarList, LineChart } from '../components/charts';
import {
  formatInt, formatMoney, formatMoneyCompact, ISO_DOW_LABELS, UNAVAILABLE,
} from '../lib/format';

export function ProductDetailPage() {
  const { ean } = useParams<{ ean: string }>();
  const navigate = useNavigate();
  const period = useCurrentPeriodParams();

  const detail = useApi(
    `product:${ean}:${period.from}:${period.to}`,
    () => analyticsApi.productDetail(ean!, { from: period.from, to: period.to, tz: period.tz }),
    [ean, period.from, period.to],
  );
  const d: any = detail.data;

  const bestDow = d?.byDayOfWeek?.length
    ? [...d.byDayOfWeek].sort((a: any, b: any) => b.quantity - a.quantity)[0]
    : null;

  return (
    <div className="pb-4">
      <PageHeader
        title={d?.product?.name ?? 'Produit'}
        subtitle={d?.product ? [d.product.brand, d.product.category].filter(Boolean).join(' · ') || undefined : undefined}
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
            {/* Identité */}
            <div className="bg-mobile-card rounded-2xl shadow-card p-3.5 flex items-center gap-3">
              {d.product.imageUrl ? (
                <img src={d.product.imageUrl} alt={d.product.name} className="w-16 h-16 rounded-xl object-cover bg-mobile-subtle shrink-0" />
              ) : (
                <span className="w-16 h-16 rounded-xl bg-mobile-subtle shrink-0 flex items-center justify-center text-mobile-muted text-[10px]">
                  Sans photo
                </span>
              )}
              <div className="min-w-0 flex-1">
                <p className="text-sm font-bold truncate">{d.product.name}</p>
                <p className="text-[11px] text-mobile-muted flex items-center gap-1">
                  <Barcode size={11} /> {d.product.ean}
                </p>
                <p className="text-[11px] text-mobile-muted">
                  Prix : {d.product.priceMinorUnits !== null
                    ? formatMoney(d.product.priceMinorUnits)
                    : `${formatMoney(d.product.priceRangeMinorUnits.min)} – ${formatMoney(d.product.priceRangeMinorUnits.max)} selon magasin`}
                </p>
                <p className="text-[11px] text-mobile-muted">
                  Stock actuel (consultation) : <span className="font-semibold text-mobile-text">{formatInt(d.product.currentStockQuantity)}</span>
                  {' '}· {d.product.catalogStoreCount} magasin(s) au catalogue
                </p>
              </div>
            </div>

            {/* KPIs période */}
            <Section title={`Ventes — ${period.label}`}>
              <div className="grid grid-cols-2 gap-3">
                <KpiCard big label="Quantité vendue" value={formatInt(d.quantity)} delta={d.previousPeriod?.quantityGrowthPct} hint="vs période préc." />
                <KpiCard label="CA généré" value={formatMoneyCompact(d.revenueMinorUnits)} delta={d.previousPeriod?.revenueGrowthPct} />
                <KpiCard label="Tickets" value={formatInt(d.ticketCount)} />
                <KpiCard label="Panier moyen (tickets avec produit)" value={formatMoney(d.avgBasketWithProductMinorUnits)} />
                <KpiCard label="Magasins vendeurs" value={formatInt(d.storeCount)} />
                <KpiCard label="Vitesse moyenne" value={`${d.avgDailyQuantity.toLocaleString('fr-FR')} / jour`} />
                <KpiCard
                  label="Rang catégorie"
                  value={d.categoryRank ? `${d.categoryRank.position}ᵉ / ${d.categoryRank.total}` : UNAVAILABLE}
                  hint={d.product.category ?? undefined}
                />
                <KpiCard
                  label="Meilleur jour"
                  value={bestDow ? ISO_DOW_LABELS[bestDow.isoDow] : UNAVAILABLE}
                  hint={bestDow ? `${formatInt(bestDow.quantity)} unités` : undefined}
                />
              </div>
            </Section>

            {/* Évolution */}
            <Section title="Évolution des ventes">
              <LineChart
                points={d.dailySeries.map((p: any) => ({
                  label: new Date(p.date).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }),
                  value: p.revenueMinorUnits,
                }))}
              />
            </Section>

            {/* Par magasin */}
            <Section title="Ventes par magasin">
              <BarList
                valueLabel="Quantité vendue"
                rows={d.perStore.map((s: any) => ({
                  id: s.storeId,
                  label: s.name,
                  sub: formatMoneyCompact(s.revenueMinorUnits),
                  value: s.quantity,
                  display: formatInt(s.quantity),
                }))}
                onSelect={(id) => navigate(`/stores/${id}`)}
              />
              {d.bestStore && d.worstStore && (
                <p className="text-[11px] text-mobile-muted px-1">
                  Meilleur : <span className="font-semibold text-mobile-text">{d.bestStore.name}</span>
                  {' '}· Le moins vendeur : <span className="font-semibold text-mobile-text">{d.worstStore.name}</span>
                </p>
              )}
            </Section>

            {/* Heures */}
            {d.hourly.length > 0 && (
              <Section title="Ventes par heure">
                <div className="bg-mobile-card rounded-2xl shadow-card p-3.5">
                  <div className="flex gap-1 items-end h-16">
                    {d.hourly.map((h: any) => {
                      const max = Math.max(...d.hourly.map((x: any) => x.quantity), 1);
                      return (
                        <div key={h.hour} className="flex-1 h-full flex flex-col items-center justify-end gap-0.5">
                          <div
                            className="w-full rounded-t bg-mobile-accent/70"
                            style={{ height: `${Math.max((h.quantity / max) * 100, 4)}%` }}
                            title={`${h.hour}h — ${formatInt(h.quantity)} u.`}
                          />
                          <span className="text-[8px] text-mobile-muted">{h.hour}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </Section>
            )}

            {/* Co-achats */}
            <Section title="Souvent achetés ensemble">
              {d.coPurchased.length ? (
                <div className="bg-mobile-card rounded-2xl shadow-card divide-y divide-mobile-border/50">
                  {d.coPurchased.map((c: any) => (
                    <button
                      key={c.ean}
                      onClick={() => navigate(`/products/${encodeURIComponent(c.ean)}`)}
                      className="w-full flex items-center justify-between px-3.5 py-2.5 text-left active:bg-mobile-subtle"
                    >
                      <span className="text-sm font-semibold truncate flex-1">{c.name}</span>
                      <span className="text-[11px] text-mobile-muted shrink-0 ml-3">{formatInt(c.ticketsTogether)} tickets communs</span>
                    </button>
                  ))}
                </div>
              ) : (
                <p className="text-center text-xs text-mobile-muted py-4">Aucun co-achat mesuré sur la période</p>
              )}
            </Section>

            {/* Variantes */}
            {d.variants.length > 0 && (
              <Section title="Performance des variantes">
                <BarList
                  rows={d.variants.map((v: any) => ({
                    id: v.ean,
                    label: v.label,
                    value: v.quantity,
                    display: formatInt(v.quantity),
                  }))}
                  onSelect={(e2) => navigate(`/products/${encodeURIComponent(e2)}`)}
                />
              </Section>
            )}

            {/* Ruptures — honnête */}
            <Section title="Ruptures">
              <div className="bg-mobile-card rounded-2xl shadow-card p-3.5">
                <p className="text-sm text-mobile-muted">
                  Nombre de ruptures passées : {UNAVAILABLE} — le système ne conserve pas
                  d'historique de stock. Stock actuel consultable ci-dessus.
                </p>
              </div>
            </Section>
          </>
        ) : null}
      </div>
    </div>
  );
}
