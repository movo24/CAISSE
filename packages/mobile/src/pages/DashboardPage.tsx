// ── Vue d'ensemble — tableau de bord réseau (lecture seule) ──────
// CA multi-fenêtres (jour/hier/semaine/mois/semestre/année), KPIs de
// la période choisie, comparaisons P-1 et N-1, meilleurs / moins bons
// points de vente, top produit, top catégorie, meilleure heure.
// Données 100 % réelles via /mobile/v1/analytics — sinon
// « Donnée indisponible ».
// ─────────────────────────────────────────────────────────────────

import { useNavigate } from 'react-router-dom';
import { Store as StoreIcon, Bell, ShieldCheck } from 'lucide-react';
import { analyticsApi } from '../services/api';
import { useApi } from '../hooks/useApi';
import { useAuthStore } from '../stores/authStore';
import { PeriodPicker, useCurrentPeriodParams } from '../components/PeriodPicker';
import {
  ErrorBanner, KpiCard, LoadingCards, PageHeader, Section, SyncBadge, DeltaBadge,
} from '../components/ui';
import {
  formatHour, formatInt, formatMoney, formatMoneyCompact, UNAVAILABLE,
} from '../lib/format';

export function DashboardPage() {
  const navigate = useNavigate();
  const employee = useAuthStore((s) => s.employee);
  const period = useCurrentPeriodParams();

  const overview = useApi(
    `overview:${period.from}:${period.to}`,
    () => analyticsApi.overview({ from: period.from, to: period.to, tz: period.tz }),
    [period.from, period.to],
  );
  const windows = useApi(
    'revenue-windows',
    () => analyticsApi.revenueWindows({ tz: period.tz }),
    [],
  );

  const o: any = overview.data;
  const w: any = windows.data;
  const isNetwork = o?.scope?.type === 'network';

  return (
    <div className="pb-4">
      <PageHeader
        title="Vue d'ensemble"
        subtitle={isNetwork ? 'Réseau complet' : 'Votre point de vente'}
        right={
          <>
            <button onClick={() => navigate('/security')} aria-label="Sécurité — mes appareils et clés d'accès" className="p-2 rounded-xl active:bg-mobile-subtle">
              <ShieldCheck size={19} className="text-mobile-muted" />
            </button>
            <button onClick={() => navigate('/alerts')} aria-label="Alertes" className="p-2 rounded-xl active:bg-mobile-subtle">
              <Bell size={19} className="text-mobile-muted" />
            </button>
          </>
        }
      />

      <div className="px-4 pt-3 space-y-4">
        <div className="flex items-center justify-between gap-2">
          <PeriodPicker />
          <span className="text-[11px] text-mobile-muted truncate">
            {employee ? `${employee.firstName} · ${employee.role}` : ''}
          </span>
        </div>

        {overview.error && <ErrorBanner message={overview.error} onRetry={overview.reload} />}
        <SyncBadge syncedAt={overview.syncedAt} fromCache={overview.fromCache} onReload={overview.reload} loading={overview.loading} />

        {/* ── CA par fenêtres calendaires ── */}
        <Section title="Chiffre d'affaires">
          {windows.error && !w && <ErrorBanner message={windows.error} onRetry={windows.reload} />}
          {windows.loading && !w ? (
            <LoadingCards count={6} />
          ) : w ? (
            <div className="grid grid-cols-2 gap-3">
              <KpiCard big label="Aujourd'hui" value={formatMoney(w.todayMinorUnits)} />
              <KpiCard label="Hier" value={formatMoney(w.yesterdayMinorUnits)} />
              <KpiCard label="Semaine" value={formatMoneyCompact(w.weekMinorUnits)} />
              <KpiCard label="Mois" value={formatMoneyCompact(w.monthMinorUnits)} />
              <KpiCard label="Semestre" value={formatMoneyCompact(w.semesterMinorUnits)} />
              <KpiCard label="Année" value={formatMoneyCompact(w.yearMinorUnits)} />
            </div>
          ) : null}
        </Section>

        {/* ── KPIs de la période sélectionnée ── */}
        <Section title={`Période : ${period.label}`}>
          {overview.loading && !o ? (
            <LoadingCards count={6} />
          ) : o ? (
            <>
              <div className="grid grid-cols-2 gap-3">
                <KpiCard
                  big
                  label="CA période"
                  value={formatMoneyCompact(o.kpis.revenueMinorUnits)}
                  delta={o.previousPeriod?.revenueGrowthPct}
                  hint="vs période préc."
                />
                <KpiCard
                  label="vs N-1"
                  value={formatMoneyCompact(o.yearAgo?.kpis?.revenueMinorUnits)}
                  delta={o.yearAgo?.revenueGrowthPct}
                  hint="même période N-1"
                />
                <KpiCard label="Tickets" value={formatInt(o.kpis.tickets)} delta={o.previousPeriod?.ticketsGrowthPct} />
                <KpiCard label="Panier moyen" value={formatMoney(o.kpis.avgTicketMinorUnits)} />
                <KpiCard label="Articles vendus" value={formatInt(o.kpis.itemsSold)} />
                <KpiCard
                  label="CA moyen / magasin"
                  value={formatMoneyCompact(o.network?.avgRevenuePerActiveStoreMinorUnits)}
                  hint={`${formatInt(o.kpis.activeStores)} actif(s)`}
                />
                <KpiCard
                  label="PDV ouverts"
                  value={o.network ? `${formatInt(o.network.openStores)} / ${formatInt(o.network.totalStores)}` : UNAVAILABLE}
                  hint="sessions POS actives"
                />
                <KpiCard label="Meilleure heure" value={formatHour(o.bestHour?.hour ?? null)} hint={o.bestHour ? formatMoneyCompact(o.bestHour.revenueMinorUnits) : undefined} />
              </div>
            </>
          ) : null}
        </Section>

        {/* ── Points de vente marquants ── */}
        {o && isNetwork && (
          <Section title="Points de vente" action={
            <button onClick={() => navigate('/stores')} className="text-xs font-semibold text-mobile-accent">Classement →</button>
          }>
            <div className="bg-mobile-card rounded-2xl shadow-card divide-y divide-mobile-border/50">
              {[
                { label: 'Meilleur point de vente', s: o.network.bestStore },
                { label: 'Plus forte progression', s: o.network.topGrowthStore },
                { label: 'En baisse', s: o.network.decliningStore },
              ].map((row) => (
                <button
                  key={row.label}
                  onClick={row.s ? () => navigate(`/stores/${row.s.storeId}`) : undefined}
                  disabled={!row.s}
                  className="w-full flex items-center gap-3 px-3.5 py-3 text-left active:bg-mobile-subtle disabled:cursor-default"
                >
                  <StoreIcon size={16} className="text-mobile-accent shrink-0" />
                  <span className="flex-1 min-w-0">
                    <span className="block text-[11px] text-mobile-muted">{row.label}</span>
                    <span className="block text-sm font-semibold truncate">{row.s?.name ?? UNAVAILABLE}</span>
                  </span>
                  {row.s && (
                    <span className="text-right shrink-0">
                      <span className="block text-sm font-bold tabular-nums">{formatMoneyCompact(row.s.revenueMinorUnits)}</span>
                      <DeltaBadge pct={row.s.growthPct} />
                    </span>
                  )}
                </button>
              ))}
            </div>
          </Section>
        )}

        {/* ── Produit & catégorie phares ── */}
        {o && (
          <Section title="Faits marquants">
            <div className="bg-mobile-card rounded-2xl shadow-card divide-y divide-mobile-border/50">
              <button
                onClick={o.topProduct ? () => navigate(`/products/${encodeURIComponent(o.topProduct.ean)}`) : undefined}
                disabled={!o.topProduct}
                className="w-full px-3.5 py-3 text-left active:bg-mobile-subtle disabled:cursor-default"
              >
                <span className="block text-[11px] text-mobile-muted">Produit le plus vendu</span>
                <span className="block text-sm font-semibold truncate">{o.topProduct?.name ?? UNAVAILABLE}</span>
                {o.topProduct && (
                  <span className="block text-[11px] text-mobile-muted">
                    {formatInt(o.topProduct.quantity)} unités · {formatMoneyCompact(o.topProduct.revenueMinorUnits)}
                  </span>
                )}
              </button>
              <div className="px-3.5 py-3">
                <span className="block text-[11px] text-mobile-muted">Catégorie la plus performante</span>
                <span className="block text-sm font-semibold truncate">{o.topCategory?.name ?? UNAVAILABLE}</span>
                {o.topCategory && (
                  <span className="block text-[11px] text-mobile-muted">{formatMoneyCompact(o.topCategory.revenueMinorUnits)}</span>
                )}
              </div>
            </div>
          </Section>
        )}

        {/* ── Objectifs (§13) — honnête : pas d'objectifs en base ── */}
        <Section title="Objectifs">
          <div className="bg-mobile-card rounded-2xl shadow-card p-3.5">
            <p className="text-sm text-mobile-muted">
              {UNAVAILABLE} — aucun objectif n'est enregistré dans le système central.
            </p>
          </div>
        </Section>
      </div>
    </div>
  );
}
