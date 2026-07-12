import React from 'react';
import {
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useColorScheme,
} from 'react-native';

import { directionApi } from '../api/direction';
import { useApiData } from '../hooks/useApiData';
import {
  Bars,
  ErrorState,
  KpiCard,
  LoadingState,
  SectionTitle,
  StalenessBanner,
  TrendPill,
} from '../ui/components';
import { formatMoneyMinor, formatPct } from '../lib/money';
import { themeFor } from '../theme';

/** Accueil réseau — la situation du réseau en moins de 10 secondes. */
export function HomeScreen() {
  const theme = themeFor(useColorScheme());
  const { data, status, lastUpdatedAt, errorMessage, refreshing, refresh } =
    useApiData(directionApi.overview, []);

  if (status === 'loading') return <LoadingState theme={theme} />;
  if (status === 'error' || !data) {
    return (
      <ErrorState
        theme={theme}
        message={errorMessage ?? 'Backend indisponible'}
        onRetry={() => void refresh()}
      />
    );
  }

  const o = data;
  const alertCount =
    o.alerts.stockCritical + o.alerts.anomaliesOpen;

  return (
    <ScrollView
      style={{ backgroundColor: theme.bg }}
      contentContainerStyle={s.content}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => void refresh()}
          tintColor={theme.accent}
        />
      }
    >
      <StalenessBanner theme={theme} status={status} lastUpdatedAt={lastUpdatedAt} />

      {/* CA du jour — le gros chiffre */}
      <View style={[s.hero, { backgroundColor: theme.card, borderColor: theme.cardBorder }]}>
        <Text style={{ color: theme.muted, fontSize: 12 }}>
          Chiffre d'affaires réseau — aujourd'hui
        </Text>
        <Text
          style={{ color: theme.text, fontSize: 40, fontWeight: '900', letterSpacing: -1 }}
          numberOfLines={1}
          adjustsFontSizeToFit
        >
          {formatMoneyMinor(o.today.revenueMinorUnits)}
        </Text>
        <View style={s.heroRow}>
          <View style={s.heroTrend}>
            <Text style={{ color: theme.muted, fontSize: 11 }}>vs hier</Text>
            <TrendPill theme={theme} pct={o.comparisons.vsYesterdayPct} />
          </View>
          <View style={s.heroTrend}>
            <Text style={{ color: theme.muted, fontSize: 11 }}>vs sem. dernière</Text>
            <TrendPill theme={theme} pct={o.comparisons.vsSameDayLastWeekPct} />
          </View>
        </View>
      </View>

      <View style={s.grid}>
        <KpiCard
          theme={theme}
          label="Tickets"
          value={o.today.transactionCount.toLocaleString('fr-FR')}
        />
        <KpiCard
          theme={theme}
          label="Panier moyen"
          value={formatMoneyMinor(o.today.averageBasketMinorUnits)}
        />
      </View>
      <View style={s.grid}>
        <KpiCard
          theme={theme}
          label="Marge brute"
          value={
            o.today.marginMinorUnits === null
              ? '—'
              : formatMoneyMinor(o.today.marginMinorUnits, 'EUR', { compact: true })
          }
          sub={
            o.today.marginRatePct === null
              ? 'coûts d’achat incomplets'
              : `taux ${formatPct(o.today.marginRatePct)}${
                  o.today.marginCoveragePct !== null && o.today.marginCoveragePct < 100
                    ? ` · ${o.today.marginCoveragePct}% du CA couvert`
                    : ''
                }`
          }
        />
        <KpiCard
          theme={theme}
          label="Magasins actifs"
          value={`${o.stores.withSalesToday}/${o.stores.total}`}
          sub={`${o.stores.withOpenSession} caisse(s) ouverte(s)`}
        />
      </View>
      <View style={s.grid}>
        <KpiCard
          theme={theme}
          label="Alertes critiques"
          value={alertCount.toString()}
          sub={`${o.alerts.stockCritical} stock · ${o.alerts.anomaliesOpen} anomalies`}
          tone={alertCount > 0 ? 'negative' : 'positive'}
        />
        <KpiCard
          theme={theme}
          label="Remboursements"
          value={formatMoneyMinor(o.refunds.totalMinorUnits)}
          sub={`${o.refunds.count} avoir(s) · ${o.voids.count} annulation(s)`}
          tone={o.refunds.count > 0 ? 'neutral' : 'positive'}
        />
      </View>

      <SectionTitle theme={theme}>Cumuls</SectionTitle>
      <Bars
        theme={theme}
        data={[
          { label: 'Semaine', value: o.toDate.weekRevenueMinorUnits },
          { label: 'Mois', value: o.toDate.monthRevenueMinorUnits },
          { label: 'Année', value: o.toDate.yearRevenueMinorUnits },
        ]}
      />
      <View style={s.cumulRow}>
        {(
          [
            ['S', o.toDate.weekRevenueMinorUnits],
            ['M', o.toDate.monthRevenueMinorUnits],
            ['A', o.toDate.yearRevenueMinorUnits],
          ] as const
        ).map(([k, v]) => (
          <Text key={k} style={{ color: theme.muted, fontSize: 12 }}>
            {k} : <Text style={{ color: theme.text, fontWeight: '700' }}>
              {formatMoneyMinor(v, 'EUR', { compact: true })}
            </Text>
          </Text>
        ))}
      </View>

      {o.payments.length > 0 ? (
        <>
          <SectionTitle theme={theme}>Moyens de paiement — aujourd'hui</SectionTitle>
          {o.payments.map((p) => (
            <View key={p.method} style={s.payRow}>
              <Text style={{ color: theme.text, textTransform: 'capitalize' }}>
                {labelForMethod(p.method)}
              </Text>
              <Text style={{ color: theme.muted, fontSize: 12 }}>{p.count}×</Text>
              <Text style={{ color: theme.text, fontWeight: '700' }}>
                {formatMoneyMinor(p.amountMinorUnits)}
              </Text>
            </View>
          ))}
        </>
      ) : null}

      {o.ranking.best.length > 0 ? (
        <>
          <SectionTitle theme={theme}>Top magasins</SectionTitle>
          {o.ranking.best.map((r, i) => (
            <View key={r.storeId} style={s.payRow}>
              <Text style={{ color: theme.text }}>
                {i + 1}. {r.name}
              </Text>
              <Text style={{ color: theme.positive, fontWeight: '700' }}>
                {formatMoneyMinor(r.revenueMinorUnits)}
              </Text>
            </View>
          ))}
          {o.ranking.worst.length > 0 ? (
            <>
              <SectionTitle theme={theme}>À surveiller</SectionTitle>
              {o.ranking.worst.map((r) => (
                <View key={r.storeId} style={s.payRow}>
                  <Text style={{ color: theme.text }}>{r.name}</Text>
                  <Text style={{ color: theme.negative, fontWeight: '700' }}>
                    {formatMoneyMinor(r.revenueMinorUnits)}
                  </Text>
                </View>
              ))}
            </>
          ) : null}
        </>
      ) : null}
    </ScrollView>
  );
}

function labelForMethod(method: string): string {
  switch (method) {
    case 'cash':
      return 'Espèces';
    case 'card':
      return 'Carte';
    case 'store_credit':
      return 'Avoir';
    default:
      return method;
  }
}

const s = StyleSheet.create({
  content: { padding: 16, paddingBottom: 48 },
  hero: { borderWidth: 1, borderRadius: 16, padding: 18, marginBottom: 12 },
  heroRow: { flexDirection: 'row', gap: 20, marginTop: 10 },
  heroTrend: { alignItems: 'flex-start', gap: 4 },
  grid: { flexDirection: 'row', gap: 12, marginBottom: 12 },
  cumulRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 8,
  },
  payRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
    gap: 8,
  },
});
