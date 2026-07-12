import React, { useEffect } from 'react';
import { Pressable, StyleSheet, Text, View, useColorScheme } from 'react-native';

import { useAuth } from '../auth/AuthContext';
import { themeFor } from '../theme';

/** Biometric gate shown when a session exists and biometry is enabled. */
export function LockScreen() {
  const theme = themeFor(useColorScheme());
  const { unlockWithBiometry, logout } = useAuth();

  useEffect(() => {
    void unlockWithBiometry();
  }, [unlockWithBiometry]);

  return (
    <View style={[s.root, { backgroundColor: theme.bg }]}>
      <Text style={[s.brand, { color: theme.accent }]}>THE WESLEY CONTROL</Text>
      <Text style={{ color: theme.text, fontSize: 18, marginTop: 8 }}>
        Application verrouillée
      </Text>
      <Pressable
        onPress={() => void unlockWithBiometry()}
        style={[s.button, { backgroundColor: theme.accent }]}
      >
        <Text style={{ color: '#0B1220', fontWeight: '800' }}>
          Déverrouiller (Face ID / empreinte)
        </Text>
      </Pressable>
      <Pressable onPress={() => void logout()} style={s.link}>
        <Text style={{ color: theme.muted }}>Se déconnecter</Text>
      </Pressable>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  brand: { fontSize: 12, fontWeight: '800', letterSpacing: 3 },
  button: { borderRadius: 10, paddingHorizontal: 22, paddingVertical: 13, marginTop: 24 },
  link: { marginTop: 16 },
});
