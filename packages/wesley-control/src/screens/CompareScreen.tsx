import React, { useMemo, useState } from 'react';
import {
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useColorScheme,
} from 'react-native';

import { directionApi } from '../api/direction';
import type { DirectionCompare } from '../api/types';
import { useApiData } from '../hooks/useApiData';
import {
  ErrorState,
  LoadingState,
  SectionTitle,
  StalenessBanner,
} from '../ui/components';
import { formatMoneyMinor } from '../lib/money';
import { initialFetchState, reduceFetchState, FetchState } from '../lib/freshness';
import { themeFor } from '../theme';

type Period = 'jour' | '7j' | '30j';

function rangeFor(period: Period): { from: string; to: string } {
  const today = new Date().toISOString().slice(0, 10);
  const shift = (days: number) => {
    const d = new Date(`${today}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - days);
    return d.toISOString().slice(0, 10);
  };
  if (period === 'jour') return { from: today, to: today };
  if (period === '7j') return { from: shift(6), to: today };
  return { from: shift(29), to: today };
}

/** Comparateur multi-magasins (jusqu'à 10). */
export function CompareScreen() {
  const theme = themeFor(useColorScheme());
  const storesState = useApiData(directionApi.stores, []);
  const [selected, setSelected] = useState<string[]>([]);
  const [period, setPeriod] = useState<Period>('jour');
  const [result, setResult] = useState<FetchState<DirectionCompare>>(
    initialFetchState<DirectionCompare>(),
  );

  const toggle = (id: string) =>
    setSelected((prev) =>
      prev.includes(id)
        ? prev.filter((x) => x !== id)
        : prev.length >= 10
          ? prev
          : [...prev, id],
    );

  const run = async () => {
    setResult((s0) => reduceFetchState(s0, { type: 'start' }));
    try {
      const { from, to } = rangeFor(period);
      const data = await directionApi.compare(selected, from, to);
      setResult((s0) =>
        reduceFetchState(s0, { type: 'success', data, at: new Date().toISOString() }),
      );
    } catch (e: unknown) {
      setResult((s0) =>
        reduceFetchState(s0, {
          type: 'failure',
          message: e instanceof Error ? e.message : 'Erreur',
        }),
      );
    }
  };

  const maxRevenue = useMemo(
    () =>
      Math.max(1, ...(result.data?.stores.map((r) => r.revenueMinorUnits) ?? [1])),
    [result.data],
  );

  if (storesState.status === 'loading') return <LoadingState theme={theme} />;
  if (storesState.status === 'error' || !storesState.data) {
    return (
      <ErrorState
        theme={theme}
        message={storesState.errorMessage ?? 'Backend indisponible'}
        onRetry={() => void storesState.refresh()}
      />
    );
  }

  return (
    <ScrollView
      style={{ backgroundColor: theme.bg }}
      contentContainerStyle={s.content}
      refreshControl={
        <RefreshControl
          refreshing={storesState.refreshing}
          onRefresh={() => void storesState.refresh()}
          tintColor={theme.accent}
        />
      }
    >
      <SectionTitle theme={theme}>1. Sélectionnez les magasins (max 10)</SectionTitle>
      <View style={s.chips}>
        {storesState.data.stores.map((st) => {
          const on = selected.includes(st.storeId);
          return (
            <Pressable
              key={st.storeId}
              onPress={() => toggle(st.storeId)}
              style={[
                s.chip,
                {
                  backgroundColor: on ? theme.accent : theme.card,
                  borderColor: on ? theme.accent : theme.cardBorder,
                },
              ]}
            >
              <Text style={{ color: on ? '#0B1220' : theme.text, fontWeight: '600', fontSize: 13 }}>
                {st.name}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <SectionTitle theme={theme}>2. Période</SectionTitle>
      <View style={s.chips}>
        {(['jour', '7j', '30j'] as Period[]).map((p) => (
          <Pressable
            key={p}
            onPress={() => setPeriod(p)}
            style={[
              s.chip,
              {
                backgroundColor: period === p ? theme.accent : theme.card,
                borderColor: period === p ? theme.accent : theme.cardBorder,
              },
            ]}
          >
            <Text style={{ color: period === p ? '#0B1220' : theme.text, fontWeight: '600' }}>
              {p === 'jour' ? "Aujourd'hui" : p === '7j' ? '7 jours' : '30 jours'}
            </Text>
          </Pressable>
        ))}
      </View>

      <Pressable
        onPress={() => void run()}
        disabled={selected.length < 2 || result.refreshing}
        style={[
          s.runBtn,
          {
            backgroundColor: theme.accent,
            opacity: selected.length < 2 || result.refreshing ? 0.5 : 1,
          },
        ]}
      >
        <Text style={{ color: '#0B1220', fontWeight: '800' }}>
          {result.refreshing ? 'Comparaison…' : `Comparer (${selected.length})`}
        </Text>
      </Pressable>

      {result.status === 'stale' || result.status === 'fresh' ? (
        <StalenessBanner
          theme={theme}
          status={result.status}
          lastUpdatedAt={result.lastUpdatedAt}
        />
      ) : null}
      {result.status === 'error' ? (
        <Text style={{ color: theme.negative, marginTop: 8 }}>{result.errorMessage}</Text>
      ) : null}

      {result.data ? (
        <>
          <SectionTitle theme={theme}>Classement CA</SectionTitle>
          {result.data.stores.map((r, i) => (
            <View key={r.storeId} style={s.resultRow}>
              <Text style={{ color: theme.muted, width: 18 }}>{i + 1}.</Text>
              <View style={{ flex: 1 }}>
                <View style={s.resultHead}>
                  <Text style={{ color: theme.text, fontWeight: '700' }} numberOfLines={1}>
                    {r.name}
                  </Text>
                  <Text style={{ color: theme.text, fontWeight: '800' }}>
                    {formatMoneyMinor(r.revenueMinorUnits)}
                  </Text>
                </View>
                <View
                  style={{
                    height: 6,
                    borderRadius: 3,
                    backgroundColor: theme.cardBorder,
                    marginVertical: 4,
                  }}
                >
                  <View
                    style={{
                      height: 6,
                      borderRadius: 3,
                      width: `${Math.max(2, (r.revenueMinorUnits / maxRevenue) * 100)}%`,
                      backgroundColor: i === 0 ? theme.positive : theme.accent,
                    }}
                  />
                </View>
                <Text style={{ color: theme.muted, fontSize: 12 }}>
                  {r.transactionCount} tickets · panier {formatMoneyMinor(r.averageBasketMinorUnits)}
                  {r.marginMinorUnits !== null
                    ? ` · marge ${formatMoneyMinor(r.marginMinorUnits, 'EUR', { compact: true })}`
                    : ''}
                </Text>
              </View>
            </View>
          ))}
        </>
      ) : null}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  content: { padding: 16, paddingBottom: 48 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  runBtn: {
    borderRadius: 10,
    paddingVertical: 13,
    alignItems: 'center',
    marginTop: 20,
    marginBottom: 12,
  },
  resultRow: { flexDirection: 'row', gap: 8, paddingVertical: 8 },
  resultHead: { flexDirection: 'row', justifyContent: 'space-between', gap: 8 },
});
