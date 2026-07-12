import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import * as LocalAuthentication from 'expo-local-authentication';

import { apiLogin, configureApi } from '../api/client';
import type { AuthEmployee } from '../api/types';
import {
  isBiometryEnabled,
  loadEmployee,
  saveEmployee,
  secureTokenStore,
  setBiometryEnabled,
} from './storage';

type AuthStatus = 'booting' | 'locked' | 'signedOut' | 'signedIn';

interface AuthContextValue {
  status: AuthStatus;
  employee: AuthEmployee | null;
  biometryEnabled: boolean;
  loginDirection(email: string, pin: string): Promise<void>;
  loginStore(storeCode: string, pin: string): Promise<void>;
  unlockWithBiometry(): Promise<boolean>;
  toggleBiometry(enabled: boolean): Promise<void>;
  logout(): Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const v = useContext(AuthContext);
  if (!v) throw new Error('useAuth outside provider');
  return v;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('booting');
  const [employee, setEmployee] = useState<AuthEmployee | null>(null);
  const [biometry, setBiometry] = useState(false);

  useEffect(() => {
    configureApi(secureTokenStore, () => {
      setEmployee(null);
      setStatus('signedOut');
    });
    (async () => {
      const [token, emp, bio] = await Promise.all([
        secureTokenStore.getRefreshToken(),
        loadEmployee(),
        isBiometryEnabled(),
      ]);
      setBiometry(bio);
      if (!token || !emp) {
        setStatus('signedOut');
        return;
      }
      // Only manager/admin may use the direction app at all.
      if (emp.role !== 'admin' && emp.role !== 'manager') {
        await secureTokenStore.clear();
        setStatus('signedOut');
        return;
      }
      setEmployee(emp);
      setStatus(bio ? 'locked' : 'signedIn');
    })();
  }, []);

  const applyLogin = useCallback(async (resp: Awaited<ReturnType<typeof apiLogin>>) => {
    if (resp.employee.role !== 'admin' && resp.employee.role !== 'manager') {
      throw new Error(
        'Accès réservé à la direction et aux responsables (rôle insuffisant).',
      );
    }
    await secureTokenStore.setTokens(resp.accessToken, resp.refreshToken);
    await saveEmployee(resp.employee);
    setEmployee(resp.employee);
    setStatus('signedIn');
  }, []);

  const loginDirection = useCallback(
    async (email: string, pin: string) => {
      await applyLogin(await apiLogin('/auth/login/admin', { email, pin }));
    },
    [applyLogin],
  );

  const loginStore = useCallback(
    async (storeCode: string, pin: string) => {
      await applyLogin(await apiLogin('/auth/login/pin', { storeId: storeCode, pin }));
    },
    [applyLogin],
  );

  const unlockWithBiometry = useCallback(async () => {
    const result = await LocalAuthentication.authenticateAsync({
      promptMessage: 'Déverrouiller The Wesley Control',
      cancelLabel: 'Annuler',
    });
    if (result.success) setStatus('signedIn');
    return result.success;
  }, []);

  const toggleBiometry = useCallback(async (enabled: boolean) => {
    if (enabled) {
      const hw = await LocalAuthentication.hasHardwareAsync();
      const enrolled = await LocalAuthentication.isEnrolledAsync();
      if (!hw || !enrolled) {
        throw new Error('Biométrie indisponible sur cet appareil.');
      }
      const check = await LocalAuthentication.authenticateAsync({
        promptMessage: 'Activer la biométrie',
      });
      if (!check.success) return;
    }
    await setBiometryEnabled(enabled);
    setBiometry(enabled);
  }, []);

  const logout = useCallback(async () => {
    await secureTokenStore.clear();
    setEmployee(null);
    setStatus('signedOut');
  }, []);

  const value = useMemo(
    () => ({
      status,
      employee,
      biometryEnabled: biometry,
      loginDirection,
      loginStore,
      unlockWithBiometry,
      toggleBiometry,
      logout,
    }),
    [
      status,
      employee,
      biometry,
      loginDirection,
      loginStore,
      unlockWithBiometry,
      toggleBiometry,
      logout,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
