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
import { useNavigation, useRoute } from '@react-navigation/native';
import type { RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

import { directionApi } from '../api/direction';
import { useApiData } from '../hooks/useApiData';
import {
  ErrorState,
  LoadingState,
  StalenessBanner,
} from '../ui/components';
import { themeFor, Theme } from '../theme';
import type { AlertsStackParams } from '../navigation-types';

/**
 * Alertes réseau — vue consolidée par magasin (stock critique / faible +
 * anomalies de caisse), drill-down sur le cockpit POS-110 existant.
 */
export function AlertsScreen() {
  const theme = themeFor(useColorScheme());
  const nav =
    useNavigation<NativeStackNavigationProp<AlertsStackParams, 'AlertsHome'>>();
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

  const withAlerts = data.stores.filter(
    (r) => r.stockCriticalCount + r.stockAlertCount + r.anomaliesOpenCount > 0,
  );

  return (
    <FlatList
      style={{ backgroundColor: theme.bg }}
      contentContainerStyle={s.content}
      data={withAlerts}
      keyExtractor={(r) => r.storeId}
      ListHeaderComponent={
        <StalenessBanner theme={theme} status={status} lastUpdatedAt={lastUpdatedAt} />
      }
      ListEmptyComponent={
        <View style={s.empty}>
          <Text style={{ color: theme.positive, fontSize: 32 }}>✓</Text>
          <Text style={{ color: theme.text, fontSize: 16, fontWeight: '600' }}>
            Aucune alerte active sur le réseau
          </Text>
        </View>
      }
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => void refresh()}
          tintColor={theme.accent}
        />
      }
      renderItem={({ item }) => (
        <Pressable
          onPress={() =>
            nav.navigate('AlertsStore', { storeId: item.storeId, name: item.name })
          }
          style={[s.row, { backgroundColor: theme.card, borderColor: theme.cardBorder }]}
        >
          <Text style={{ color: theme.text, fontWeight: '700' }}>{item.name}</Text>
          <View style={s.badges}>
            {item.stockCriticalCount > 0 ? (
              <Badge theme={theme} color={theme.critical} text={`${item.stockCriticalCount} rupture/critique`} />
            ) : null}
            {item.stockAlertCount > 0 ? (
              <Badge theme={theme} color={theme.warning} text={`${item.stockAlertCount} stock faible`} />
            ) : null}
            {item.anomaliesOpenCount > 0 ? (
              <Badge theme={theme} color={theme.negative} text={`${item.anomaliesOpenCount} anomalie(s) caisse`} />
            ) : null}
          </View>
        </Pressable>
      )}
    />
  );
}

/** Fiche alertes d'un magasin — consomme le cockpit POS-110 tel quel. */
export function AlertsStoreScreen() {
  const theme = themeFor(useColorScheme());
  const route = useRoute<RouteProp<AlertsStackParams, 'AlertsStore'>>();
  const { storeId } = route.params;
  const { data, status, lastUpdatedAt, errorMessage, refreshing, refresh } =
    useApiData(() => directionApi.cockpitAlerts(storeId), [storeId]);

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

  const sections: { title: string; color: string; items: string[] }[] = [
    {
      title: 'Stock critique / rupture',
      color: theme.critical,
      items: data.stock.critical.map(
        (p) => `${p.name} — reste ${p.stockQuantity}`,
      ),
    },
    {
      title: 'Stock faible',
      color: theme.warning,
      items: data.stock.alert.map((p) => `${p.name} — reste ${p.stockQuantity}`),
    },
    {
      title: 'Anomalies de caisse',
      color: theme.negative,
      items: data.anomalies.map((a) => `[${a.severity}] ${a.message}`),
    },
  ];

  return (
    <FlatList
      style={{ backgroundColor: theme.bg }}
      contentContainerStyle={s.content}
      data={sections.filter((sec) => sec.items.length > 0)}
      keyExtractor={(sec) => sec.title}
      ListHeaderComponent={
        <StalenessBanner theme={theme} status={status} lastUpdatedAt={lastUpdatedAt} />
      }
      ListEmptyComponent={
        <View style={s.empty}>
          <Text style={{ color: theme.positive, fontSize: 32 }}>✓</Text>
          <Text style={{ color: theme.text }}>Aucune alerte pour ce magasin</Text>
        </View>
      }
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => void refresh()}
          tintColor={theme.accent}
        />
      }
      renderItem={({ item }) => (
        <View style={[s.row, { backgroundColor: theme.card, borderColor: theme.cardBorder }]}>
          <Text style={{ color: item.color, fontWeight: '700', marginBottom: 6 }}>
            {item.title} ({item.items.length})
          </Text>
          {item.items.map((line, i) => (
            <Text key={i} style={{ color: theme.text, fontSize: 13, paddingVertical: 2 }}>
              {line}
            </Text>
          ))}
        </View>
      )}
    />
  );
}

function Badge({ theme, color, text }: { theme: Theme; color: string; text: string }) {
  return (
    <Text
      style={{
        color,
        borderColor: color + '55',
        backgroundColor: color + '15',
        borderWidth: 1,
        borderRadius: 999,
        paddingHorizontal: 8,
        paddingVertical: 2,
        fontSize: 11,
        fontWeight: '700',
        overflow: 'hidden',
      }}
    >
      {text}
    </Text>
  );
}

const s = StyleSheet.create({
  content: { padding: 16, paddingBottom: 48, gap: 10 },
  row: { borderWidth: 1, borderRadius: 14, padding: 14, gap: 6 },
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  empty: { alignItems: 'center', marginTop: 60, gap: 8 },
});
