import React from 'react';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useColorScheme } from 'react-native';

import { AuthProvider, useAuth } from './src/auth/AuthContext';
import { LoginScreen } from './src/screens/LoginScreen';
import { LockScreen } from './src/screens/LockScreen';
import { RootNavigation } from './src/navigation';
import { LoadingState } from './src/ui/components';
import { themeFor } from './src/theme';

function Gate() {
  const { status } = useAuth();
  const theme = themeFor(useColorScheme());

  switch (status) {
    case 'booting':
      return <LoadingState theme={theme} />;
    case 'signedOut':
      return <LoginScreen />;
    case 'locked':
      return <LockScreen />;
    case 'signedIn':
      return <RootNavigation />;
  }
}

export default function App() {
  return (
    <SafeAreaProvider>
      <AuthProvider>
        <StatusBar style="auto" />
        <Gate />
      </AuthProvider>
    </SafeAreaProvider>
  );
}
