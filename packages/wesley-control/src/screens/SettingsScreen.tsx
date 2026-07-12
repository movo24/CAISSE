import React, { useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
  useColorScheme,
} from 'react-native';

import { useAuth } from '../auth/AuthContext';
import { APP_VERSION, apiBaseUrl } from '../config';
import { themeFor } from '../theme';

export function SettingsScreen() {
  const theme = themeFor(useColorScheme());
  const { employee, biometryEnabled, toggleBiometry, logout } = useAuth();
  const [bioError, setBioError] = useState<string | null>(null);

  const onToggleBio = async (v: boolean) => {
    setBioError(null);
    try {
      await toggleBiometry(v);
    } catch (e: unknown) {
      setBioError(e instanceof Error ? e.message : 'Biométrie indisponible');
    }
  };

  return (
    <ScrollView style={{ backgroundColor: theme.bg }} contentContainerStyle={s.content}>
      <View style={[s.card, { backgroundColor: theme.card, borderColor: theme.cardBorder }]}>
        <Text style={{ color: theme.muted, fontSize: 12 }}>Connecté en tant que</Text>
        <Text style={{ color: theme.text, fontSize: 17, fontWeight: '700' }}>
          {employee ? `${employee.firstName ?? ''} ${employee.lastName ?? ''}`.trim() || 'Utilisateur' : '—'}
        </Text>
        <Text style={{ color: theme.accent, fontSize: 13, fontWeight: '600' }}>
          {employee?.role === 'admin' ? 'Direction réseau (tous magasins)' : 'Responsable magasin'}
        </Text>
      </View>

      <View style={[s.card, { backgroundColor: theme.card, borderColor: theme.cardBorder }]}>
        <View style={s.row}>
          <View style={{ flex: 1 }}>
            <Text style={{ color: theme.text, fontWeight: '600' }}>
              Verrouillage biométrique
            </Text>
            <Text style={{ color: theme.muted, fontSize: 12 }}>
              Face ID / Touch ID / empreinte à l'ouverture
            </Text>
          </View>
          <Switch
            value={biometryEnabled}
            onValueChange={(v) => void onToggleBio(v)}
            trackColor={{ true: theme.accent }}
          />
        </View>
        {bioError ? (
          <Text style={{ color: theme.negative, fontSize: 12, marginTop: 6 }}>{bioError}</Text>
        ) : null}
      </View>

      <View style={[s.card, { backgroundColor: theme.card, borderColor: theme.cardBorder }]}>
        <Text style={{ color: theme.muted, fontSize: 12 }}>Notifications push</Text>
        <Text style={{ color: theme.text, fontSize: 13, marginTop: 4 }}>
          Disponibles dans une prochaine version (nécessitent les certificats
          Apple/Google du compte owner).
        </Text>
      </View>

      <View style={[s.card, { backgroundColor: theme.card, borderColor: theme.cardBorder }]}>
        <Text style={{ color: theme.muted, fontSize: 12 }}>Application</Text>
        <Text style={{ color: theme.text, fontSize: 13, marginTop: 4 }}>
          Version {APP_VERSION}
        </Text>
        <Text style={{ color: theme.muted, fontSize: 12, marginTop: 2 }} numberOfLines={1}>
          Backend : {apiBaseUrl()}
        </Text>
        <Text style={{ color: theme.muted, fontSize: 12, marginTop: 2 }}>
          Thème : suit le réglage clair/sombre du téléphone
        </Text>
      </View>

      <Pressable
        onPress={() => void logout()}
        style={[s.logout, { borderColor: theme.negative }]}
      >
        <Text style={{ color: theme.negative, fontWeight: '700' }}>Se déconnecter</Text>
      </Pressable>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  content: { padding: 16, paddingBottom: 48, gap: 12 },
  card: { borderWidth: 1, borderRadius: 14, padding: 14 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  logout: {
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 13,
    alignItems: 'center',
    marginTop: 8,
  },
});
