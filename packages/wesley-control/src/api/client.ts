/**
 * Minimal fetch-based API client with:
 *  - Bearer token injection from the secure session store
 *  - single-flight refresh on 401 / proactive expiry (same contract as the
 *    existing CAISSE front clients: POST /auth/refresh { refreshToken })
 *  - request timeout (12 s) so a dead backend degrades into the stale state
 *    instead of hanging the UI.
 *
 * No secret lives here — only the caller's own JWTs, kept in Keychain/Keystore
 * via expo-secure-store (see auth/storage.ts).
 */
import { apiBaseUrl } from '../config';
import type { AuthResponse } from './types';

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
    readonly kind: 'http' | 'network' | 'timeout' | 'auth',
  ) {
    super(message);
  }
}

export interface TokenStore {
  getAccessToken(): Promise<string | null>;
  getRefreshToken(): Promise<string | null>;
  setTokens(access: string, refresh: string): Promise<void>;
  clear(): Promise<void>;
}

const TIMEOUT_MS = 12000;

let tokenStore: TokenStore | null = null;
let onSessionExpired: (() => void) | null = null;
let refreshInFlight: Promise<boolean> | null = null;

export function configureApi(store: TokenStore, sessionExpired: () => void) {
  tokenStore = store;
  onSessionExpired = sessionExpired;
}

/** Decode a JWT `exp` (seconds) without verifying — display/refresh only. */
export function jwtExpiresAt(token: string): number | null {
  try {
    const [, payload] = token.split('.');
    if (!payload) return null;
    const json = JSON.parse(
      typeof atob === 'function'
        ? atob(payload.replace(/-/g, '+').replace(/_/g, '/'))
        : Buffer.from(payload, 'base64').toString('utf8'),
    );
    return typeof json.exp === 'number' ? json.exp * 1000 : null;
  } catch {
    return null;
  }
}

function isExpired(token: string, skewMs = 30000): boolean {
  const exp = jwtExpiresAt(token);
  return exp !== null && Date.now() + skewMs >= exp;
}

async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (e: unknown) {
    if ((e as Error)?.name === 'AbortError') {
      throw new ApiError('Délai dépassé — réseau lent ou backend indisponible', null, 'timeout');
    }
    throw new ApiError('Réseau indisponible', null, 'network');
  } finally {
    clearTimeout(timer);
  }
}

async function refreshTokens(): Promise<boolean> {
  if (!tokenStore) return false;
  if (!refreshInFlight) {
    refreshInFlight = (async () => {
      const refreshToken = await tokenStore!.getRefreshToken();
      if (!refreshToken) return false;
      try {
        const res = await fetchWithTimeout(`${apiBaseUrl()}/auth/refresh`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refreshToken }),
        });
        if (!res.ok) return false;
        const body = (await res.json()) as { accessToken?: string; refreshToken?: string };
        if (!body.accessToken) return false;
        await tokenStore!.setTokens(body.accessToken, body.refreshToken ?? refreshToken);
        return true;
      } catch {
        return false;
      } finally {
        // allow the next refresh attempt after this one settles
        setTimeout(() => {
          refreshInFlight = null;
        }, 0);
      }
    })();
  }
  return refreshInFlight;
}

async function expireSession(): Promise<never> {
  await tokenStore?.clear();
  onSessionExpired?.();
  throw new ApiError('Session expirée — reconnectez-vous', 401, 'auth');
}

/** Authenticated GET returning parsed JSON. */
export async function apiGet<T>(path: string): Promise<T> {
  if (!tokenStore) throw new ApiError('API non configurée', null, 'network');

  let token = await tokenStore.getAccessToken();
  if (!token) return expireSession();
  if (isExpired(token)) {
    const ok = await refreshTokens();
    if (!ok) return expireSession();
    token = await tokenStore.getAccessToken();
  }

  const doFetch = (bearer: string) =>
    fetchWithTimeout(`${apiBaseUrl()}${path}`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${bearer}`, Accept: 'application/json' },
    });

  let res = await doFetch(token!);
  if (res.status === 401) {
    const ok = await refreshTokens();
    if (!ok) return expireSession();
    res = await doFetch((await tokenStore.getAccessToken())!);
    if (res.status === 401) return expireSession();
  }
  if (!res.ok) {
    throw new ApiError(`Erreur serveur (${res.status})`, res.status, 'http');
  }
  return (await res.json()) as T;
}

/** Unauthenticated login calls. */
export async function apiLogin(
  path: '/auth/login/admin' | '/auth/login/pin',
  body: Record<string, string>,
): Promise<AuthResponse> {
  const res = await fetchWithTimeout(`${apiBaseUrl()}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (res.status === 401 || res.status === 403) {
    throw new ApiError('Identifiants invalides', res.status, 'auth');
  }
  if (res.status === 429) {
    throw new ApiError('Trop de tentatives — réessayez dans une minute', 429, 'http');
  }
  if (!res.ok) {
    throw new ApiError(`Connexion impossible (${res.status})`, res.status, 'http');
  }
  return (await res.json()) as AuthResponse;
}
