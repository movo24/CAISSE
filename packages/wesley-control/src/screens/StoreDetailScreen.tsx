import React from 'react';
import {
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useColorScheme,
} from 'react-native';
import type { RouteProp } from '@react-navigation/native';
import { useRoute } from '@react-navigation/native';

import { directionApi } from '../api/direction';
import { useApiData } from '../hooks/useApiData';
import {
  Bars,
  ErrorState,
  KpiCard,
  LoadingState,
  SectionTitle,
  StalenessBanner,
} from '../ui/components';
import { formatMoneyMinor, formatPct } from '../lib/money';
import { sinceLabel } from '../lib/freshness';
import { themeFor } from '../theme';
import type { StoresStackParams } from '../navigation-types';

export function StoreDetailScreen() {
  const theme = themeFor(useColorScheme());
  const route = useRoute<RouteProp<StoresStackParams, 'StoreDetail'>>();
  const { storeId } = route.params;
  const { data, status, lastUpdatedAt, errorMessage, refreshing, refresh } =
    useApiData(() => directionApi.storeDetail(storeId), [storeId]);

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

  const d = data;
  const activeHours = d.hourly.filter((h) => h.hour >= 7 && h.hour <= 22);

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

      <View style={s.grid}>
        <KpiCard
          theme={theme}
          label="CA du jour"
          value={formatMoneyMinor(d.kpi.revenueMinorUnits)}
        />
        <KpiCard
          theme={theme}
          label="Tickets"
          value={d.kpi.transactionCount.toLocaleString('fr-FR')}
          sub={`panier ${formatMoneyMinor(d.kpi.averageBasketMinorUnits)}`}
        />
      </View>
      <View style={s.grid}>
        <KpiCard
          theme={theme}
          label="Marge brute"
          value={d.kpi.marginMinorUnits === null ? '—' : formatMoneyMinor(d.kpi.marginMinorUnits)}
          sub={d.kpi.marginRatePct === null ? null : `taux ${formatPct(d.kpi.marginRatePct)}`}
        />
        <KpiCard
          theme={theme}
          label="Remises"
          value={formatMoneyMinor(d.kpi.discountTotalMinorUnits)}
        />
      </View>

      <SectionTitle theme={theme}>CA heure par heure (7h–22h)</SectionTitle>
      <Bars
        theme={theme}
        data={activeHours.map((h) => ({
          label: `${h.hour}`,
          value: h.revenueMinorUnits,
        }))}
      />

      {d.payments.length > 0 ? (
        <>
          <SectionTitle theme={theme}>Moyens de paiement</SectionTitle>
          {d.payments.map((p) => (
            <Row
              key={p.method}
              left={p.method === 'cash' ? 'Espèces' : p.method === 'card' ? 'Carte' : p.method}
              mid={`${p.count}×`}
              right={formatMoneyMinor(p.amountMinorUnits)}
              theme={theme}
            />
          ))}
        </>
      ) : null}

      <SectionTitle theme={theme}>Retours & annulations</SectionTitle>
      <Row
        left="Remboursements / avoirs"
        mid={`${d.refunds.count}`}
        right={formatMoneyMinor(d.refunds.totalMinorUnits)}
        theme={theme}
      />
      <Row left="Ventes annulées" mid="" right={`${d.voids.count}`} theme={theme} />
      <Row
        left="Écart de caisse (sessions clôturées)"
        mid={`${d.cash.closedSessionsCounted} session(s) comptée(s)`}
        right={
          d.cash.varianceMinorUnits === null
            ? '—'
            : formatMoneyMinor(d.cash.varianceMinorUnits)
        }
        theme={theme}
        rightColor={
          d.cash.varianceMinorUnits === null
            ? theme.muted
            : d.cash.varianceMinorUnits === 0
              ? theme.positive
              : d.cash.varianceMinorUnits < 0
                ? theme.negative
                : theme.warning
        }
      />

      {d.topProducts.length > 0 ? (
        <>
          <SectionTitle theme={theme}>Top produits</SectionTitle>
          {d.topProducts.map((p, i) => (
            <Row
              key={p.productId}
              left={`${i + 1}. ${p.name}`}
              mid={`${p.quantity} u.`}
              right={formatMoneyMinor(p.revenueMinorUnits)}
              theme={theme}
            />
          ))}
        </>
      ) : null}

      <SectionTitle theme={theme}>Caisses & terminaux</SectionTitle>
      {d.sessions.open.length === 0 ? (
        <Text style={{ color: theme.muted, fontSize: 13 }}>Aucune caisse ouverte.</Text>
      ) : (
        d.sessions.open.map((sess) => (
          <Row
            key={sess.id}
            left={`Caisse ouverte — ${sess.employeeName}`}
            mid={sess.terminalId ?? ''}
            right={`depuis ${sinceLabel(sess.openedAt, new Date()).replace('il y a ', '')}`}
            theme={theme}
          />
        ))
      )}
      {d.terminals.map((t) => (
        <Row
          key={t.id}
          left={`TPE ${t.label}`}
          mid={t.status}
          right={t.lastSeenAt ? sinceLabel(t.lastSeenAt, new Date()) : 'jamais vu'}
          theme={theme}
          rightColor={t.status === 'ONLINE' ? theme.positive : theme.negative}
        />
      ))}

      <SectionTitle theme={theme}>Alertes</SectionTitle>
      <Row
        left="Stock critique"
        mid=""
        right={`${d.alerts.stockCritical}`}
        theme={theme}
        rightColor={d.alerts.stockCritical > 0 ? theme.negative : theme.positive}
      />
      <Row
        left="Stock faible"
        mid=""
        right={`${d.alerts.stockAlert}`}
        theme={theme}
        rightColor={d.alerts.stockAlert > 0 ? theme.warning : theme.positive}
      />
      <Row
        left="Anomalies de caisse ouvertes"
        mid=""
        right={`${d.alerts.anomaliesOpen}`}
        theme={theme}
        rightColor={d.alerts.anomaliesOpen > 0 ? theme.negative : theme.positive}
      />
    </ScrollView>
  );
}

function Row({
  left,
  mid,
  right,
  theme,
  rightColor,
}: {
  left: string;
  mid: string;
  right: string;
  theme: ReturnType<typeof themeFor>;
  rightColor?: string;
}) {
  return (
    <View style={s.row}>
      <Text style={{ color: theme.text, flex: 1 }} numberOfLines={1}>
        {left}
      </Text>
      {mid ? <Text style={{ color: theme.muted, fontSize: 12 }}>{mid}</Text> : null}
      <Text style={{ color: rightColor ?? theme.text, fontWeight: '700' }}>{right}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  content: { padding: 16, paddingBottom: 48 },
  grid: { flexDirection: 'row', gap: 12, marginBottom: 12 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 8,
  },
});
