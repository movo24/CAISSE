import React, { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  useColorScheme,
} from 'react-native';

import { useAuth } from '../auth/AuthContext';
import { themeFor } from '../theme';

type Mode = 'direction' | 'magasin';

export function LoginScreen() {
  const theme = themeFor(useColorScheme());
  const { loginDirection, loginStore } = useAuth();
  const [mode, setMode] = useState<Mode>('direction');
  const [email, setEmail] = useState('');
  const [storeCode, setStoreCode] = useState('');
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setError(null);
    setBusy(true);
    try {
      if (mode === 'direction') {
        if (!email.trim() || !pin) throw new Error('Email et code PIN requis.');
        await loginDirection(email.trim().toLowerCase(), pin);
      } else {
        if (!storeCode.trim() || !pin) throw new Error('Code magasin et PIN requis.');
        await loginStore(storeCode.trim(), pin);
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Connexion impossible.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={[s.root, { backgroundColor: theme.bg }]}
    >
      <View style={s.inner}>
        <Text style={[s.brand, { color: theme.accent }]}>THE WESLEY</Text>
        <Text style={[s.title, { color: theme.text }]}>Control</Text>
        <Text style={[s.subtitle, { color: theme.muted }]}>
          Pilotage réseau — accès direction & responsables
        </Text>

        <View style={[s.tabs, { borderColor: theme.cardBorder }]}>
          {(['direction', 'magasin'] as Mode[]).map((m) => (
            <Pressable
              key={m}
              onPress={() => setMode(m)}
              style={[s.tab, mode === m && { backgroundColor: theme.card }]}
            >
              <Text
                style={{
                  color: mode === m ? theme.text : theme.muted,
                  fontWeight: '600',
                  textTransform: 'capitalize',
                }}
              >
                {m === 'direction' ? 'Direction' : 'Responsable magasin'}
              </Text>
            </Pressable>
          ))}
        </View>

        {mode === 'direction' ? (
          <TextInput
            placeholder="Email"
            placeholderTextColor={theme.muted}
            autoCapitalize="none"
            keyboardType="email-address"
            autoComplete="email"
            value={email}
            onChangeText={setEmail}
            style={[s.input, { backgroundColor: theme.card, color: theme.text, borderColor: theme.cardBorder }]}
          />
        ) : (
          <TextInput
            placeholder="Code magasin"
            placeholderTextColor={theme.muted}
            autoCapitalize="characters"
            value={storeCode}
            onChangeText={setStoreCode}
            style={[s.input, { backgroundColor: theme.card, color: theme.text, borderColor: theme.cardBorder }]}
          />
        )}
        <TextInput
          placeholder="Code PIN"
          placeholderTextColor={theme.muted}
          secureTextEntry
          keyboardType="number-pad"
          value={pin}
          onChangeText={setPin}
          style={[s.input, { backgroundColor: theme.card, color: theme.text, borderColor: theme.cardBorder }]}
        />

        {error ? (
          <Text style={{ color: theme.negative, marginTop: 8 }}>{error}</Text>
        ) : null}

        <Pressable
          onPress={submit}
          disabled={busy}
          style={[s.button, { backgroundColor: theme.accent, opacity: busy ? 0.6 : 1 }]}
        >
          <Text style={s.buttonText}>{busy ? 'Connexion…' : 'Se connecter'}</Text>
        </Pressable>

        <Text style={[s.footnote, { color: theme.muted }]}>
          Lecture seule — aucune action de caisse depuis cette application.
        </Text>
      </View>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, justifyContent: 'center' },
  inner: { paddingHorizontal: 28 },
  brand: { fontSize: 13, fontWeight: '800', letterSpacing: 4 },
  title: { fontSize: 34, fontWeight: '800', marginBottom: 4 },
  subtitle: { fontSize: 13, marginBottom: 24 },
  tabs: {
    flexDirection: 'row',
    borderWidth: 1,
    borderRadius: 10,
    marginBottom: 16,
    overflow: 'hidden',
  },
  tab: { flex: 1, paddingVertical: 10, alignItems: 'center' },
  input: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    marginTop: 10,
  },
  button: {
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 18,
  },
  buttonText: { color: '#0B1220', fontWeight: '800', fontSize: 16 },
  footnote: { fontSize: 11, textAlign: 'center', marginTop: 18 },
});
