import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { formatMoneyMinor, formatPct } from '../lib/money';
import { sinceLabel } from '../lib/freshness';
import type { Theme } from '../theme';

/** Freshness banner — shows "données non actualisées" when stale. */
export function StalenessBanner({
  theme,
  status,
  lastUpdatedAt,
}: {
  theme: Theme;
  status: 'loading' | 'fresh' | 'stale' | 'error';
  lastUpdatedAt: string | null;
}) {
  if (status === 'fresh') {
    return (
      <Text style={[s.updatedAt, { color: theme.muted }]}>
        Mis à jour {sinceLabel(lastUpdatedAt, new Date())}
      </Text>
    );
  }
  if (status === 'stale') {
    return (
      <View style={[s.staleBanner, { backgroundColor: theme.warning + '26', borderColor: theme.warning }]}>
        <Text style={{ color: theme.warning, fontWeight: '600', fontSize: 12 }}>
          ⚠ Données non actualisées — dernier état connu ({sinceLabel(lastUpdatedAt, new Date())})
        </Text>
      </View>
    );
  }
  return null;
}

export function ErrorState({
  theme,
  message,
  onRetry,
}: {
  theme: Theme;
  message: string;
  onRetry: () => void;
}) {
  return (
    <View style={s.center}>
      <Text style={{ color: theme.text, fontSize: 16, marginBottom: 8 }}>
        Impossible de charger les données
      </Text>
      <Text style={{ color: theme.muted, textAlign: 'center', marginBottom: 16 }}>
        {message}
      </Text>
      <Pressable
        onPress={onRetry}
        style={[s.retryBtn, { backgroundColor: theme.accent }]}
      >
        <Text style={{ color: '#0B1220', fontWeight: '700' }}>Réessayer</Text>
      </Pressable>
    </View>
  );
}

export function LoadingState({ theme }: { theme: Theme }) {
  return (
    <View style={s.center}>
      <ActivityIndicator color={theme.accent} size="large" />
    </View>
  );
}

/** Big-number KPI card. */
export function KpiCard({
  theme,
  label,
  value,
  sub,
  tone,
}: {
  theme: Theme;
  label: string;
  value: string;
  sub?: string | null;
  tone?: 'positive' | 'negative' | 'neutral';
}) {
  const subColor =
    tone === 'positive'
      ? theme.positive
      : tone === 'negative'
        ? theme.negative
        : theme.muted;
  return (
    <View style={[s.card, { backgroundColor: theme.card, borderColor: theme.cardBorder }]}>
      <Text style={[s.kpiLabel, { color: theme.muted }]}>{label}</Text>
      <Text style={[s.kpiValue, { color: theme.text }]} numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </Text>
      {sub ? <Text style={[s.kpiSub, { color: subColor }]}>{sub}</Text> : null}
    </View>
  );
}

/** Variation pill: green up / red down / muted em-dash. */
export function TrendPill({ theme, pct }: { theme: Theme; pct: number | null }) {
  const color =
    pct === null ? theme.muted : pct >= 0 ? theme.positive : theme.negative;
  return (
    <Text style={[s.pill, { color, borderColor: color + '55', backgroundColor: color + '15' }]}>
      {formatPct(pct)}
    </Text>
  );
}

export function SectionTitle({ theme, children }: { theme: Theme; children: string }) {
  return <Text style={[s.section, { color: theme.text }]}>{children}</Text>;
}

/** Simple horizontal bar chart (pure Views — no chart lib). */
export function Bars({
  theme,
  data,
  height = 96,
}: {
  theme: Theme;
  data: { label: string; value: number }[];
  height?: number;
}) {
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <View style={[s.bars, { height }]}>
      {data.map((d, i) => (
        <View key={i} style={s.barCol}>
          <View
            style={{
              height: Math.max(2, (d.value / max) * (height - 18)),
              backgroundColor: d.value > 0 ? theme.accent : theme.cardBorder,
              borderRadius: 2,
              width: '70%',
            }}
          />
          <Text style={{ color: theme.muted, fontSize: 8 }} numberOfLines={1}>
            {d.label}
          </Text>
        </View>
      ))}
    </View>
  );
}

export function MoneyText({
  theme,
  minor,
  size = 15,
  bold,
}: {
  theme: Theme;
  minor: number;
  size?: number;
  bold?: boolean;
}) {
  return (
    <Text style={{ color: theme.text, fontSize: size, fontWeight: bold ? '700' : '400' }}>
      {formatMoneyMinor(minor)}
    </Text>
  );
}

const s = StyleSheet.create({
  card: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 14,
    flex: 1,
    minWidth: 140,
  },
  kpiLabel: { fontSize: 12, marginBottom: 4 },
  kpiValue: { fontSize: 26, fontWeight: '800', letterSpacing: -0.5 },
  kpiSub: { fontSize: 12, marginTop: 4, fontWeight: '600' },
  pill: {
    fontSize: 12,
    fontWeight: '700',
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 2,
    overflow: 'hidden',
  },
  section: { fontSize: 15, fontWeight: '700', marginTop: 20, marginBottom: 8 },
  bars: { flexDirection: 'row', alignItems: 'flex-end' },
  barCol: { flex: 1, alignItems: 'center', justifyContent: 'flex-end', gap: 2 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  retryBtn: { borderRadius: 10, paddingHorizontal: 20, paddingVertical: 10 },
  staleBanner: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    marginBottom: 8,
  },
  updatedAt: { fontSize: 11, marginBottom: 8 },
});
