import React from 'react';
import {
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
  useColorScheme,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

import { directionApi } from '../api/direction';
import type { DirectionStoreRow } from '../api/types';
import { useApiData } from '../hooks/useApiData';
import {
  ErrorState,
  LoadingState,
  StalenessBanner,
  TrendPill,
} from '../ui/components';
import { formatMoneyMinor } from '../lib/money';
import { themeFor, Theme } from '../theme';
import type { StoresStackParams } from '../navigation-types';

export function StoresScreen() {
  const theme = themeFor(useColorScheme());
  const nav =
    useNavigation<NativeStackNavigationProp<StoresStackParams, 'StoresList'>>();
  const { data, status, lastUpdatedAt, errorMessage, refreshing, refresh } =
    useApiData(directionApi.stores, []);

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

  return (
    <FlatList
      style={{ backgroundColor: theme.bg }}
      contentContainerStyle={s.content}
      data={data.stores}
      keyExtractor={(item) => item.storeId}
      ListHeaderComponent={
        <StalenessBanner theme={theme} status={status} lastUpdatedAt={lastUpdatedAt} />
      }
      ListEmptyComponent={
        <Text style={{ color: theme.muted, textAlign: 'center', marginTop: 40 }}>
          Aucun magasin accessible.
        </Text>
      }
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => void refresh()}
          tintColor={theme.accent}
        />
      }
      renderItem={({ item }) => (
        <StoreRow
          theme={theme}
          row={item}
          onPress={() =>
            nav.navigate('StoreDetail', { storeId: item.storeId, name: item.name })
          }
        />
      )}
    />
  );
}

function StoreRow({
  theme,
  row,
  onPress,
}: {
  theme: Theme;
  row: DirectionStoreRow;
  onPress: () => void;
}) {
  const alerts = row.stockCriticalCount + row.anomaliesOpenCount;
  return (
    <Pressable
      onPress={onPress}
      style={[s.row, { backgroundColor: theme.card, borderColor: theme.cardBorder }]}
    >
      <View style={s.rowHead}>
        <View style={s.rowTitle}>
          <View
            style={[
              s.dot,
              { backgroundColor: row.hasOpenSession ? theme.positive : theme.muted },
            ]}
          />
          <Text style={{ color: theme.text, fontWeight: '700', fontSize: 15 }} numberOfLines={1}>
            {row.name}
          </Text>
          {row.city ? (
            <Text style={{ color: theme.muted, fontSize: 12 }}> · {row.city}</Text>
          ) : null}
        </View>
        <TrendPill theme={theme} pct={row.vsYesterdayPct} />
      </View>
      <View style={s.rowKpis}>
        <Text style={{ color: theme.text, fontSize: 18, fontWeight: '800' }}>
          {formatMoneyMinor(row.revenueMinorUnits)}
        </Text>
        <Text style={{ color: theme.muted, fontSize: 12 }}>
          {row.transactionCount} tickets · panier{' '}
          {formatMoneyMinor(row.averageBasketMinorUnits)}
        </Text>
      </View>
      {alerts > 0 ? (
        <Text style={{ color: theme.negative, fontSize: 12, fontWeight: '600' }}>
          ⚠ {row.stockCriticalCount} stock critique · {row.anomaliesOpenCount} anomalie(s)
        </Text>
      ) : null}
    </Pressable>
  );
}

const s = StyleSheet.create({
  content: { padding: 16, paddingBottom: 48, gap: 10 },
  row: { borderWidth: 1, borderRadius: 14, padding: 14, gap: 6 },
  rowHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
  },
  rowTitle: { flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  rowKpis: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
  },
});
