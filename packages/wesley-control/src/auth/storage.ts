/**
 * Secure session storage — tokens live in the iOS Keychain / Android Keystore
 * via expo-secure-store, never in AsyncStorage or plain files. Non-sensitive
 * preferences (biometry toggle) also live here for simplicity.
 */
import * as SecureStore from 'expo-secure-store';

import type { TokenStore } from '../api/client';
import type { AuthEmployee } from '../api/types';

const K_ACCESS = 'wc.accessToken';
const K_REFRESH = 'wc.refreshToken';
const K_EMPLOYEE = 'wc.employee';
const K_BIOMETRY = 'wc.biometryEnabled';

export const secureTokenStore: TokenStore = {
  getAccessToken: () => SecureStore.getItemAsync(K_ACCESS),
  getRefreshToken: () => SecureStore.getItemAsync(K_REFRESH),
  async setTokens(access: string, refresh: string) {
    await SecureStore.setItemAsync(K_ACCESS, access);
    await SecureStore.setItemAsync(K_REFRESH, refresh);
  },
  async clear() {
    await SecureStore.deleteItemAsync(K_ACCESS);
    await SecureStore.deleteItemAsync(K_REFRESH);
    await SecureStore.deleteItemAsync(K_EMPLOYEE);
  },
};

export async function saveEmployee(e: AuthEmployee): Promise<void> {
  await SecureStore.setItemAsync(K_EMPLOYEE, JSON.stringify(e));
}

export async function loadEmployee(): Promise<AuthEmployee | null> {
  const raw = await SecureStore.getItemAsync(K_EMPLOYEE);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as AuthEmployee;
  } catch {
    return null;
  }
}

export async function setBiometryEnabled(enabled: boolean): Promise<void> {
  await SecureStore.setItemAsync(K_BIOMETRY, enabled ? '1' : '0');
}

export async function isBiometryEnabled(): Promise<boolean> {
  return (await SecureStore.getItemAsync(K_BIOMETRY)) === '1';
}
