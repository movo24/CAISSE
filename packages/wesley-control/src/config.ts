import Constants from 'expo-constants';

/**
 * API base URL resolution — NO secret is ever embedded here; this is only a
 * public endpoint URL. Priority:
 *   1. EXPO_PUBLIC_API_URL (set per EAS build profile)
 *   2. app.json extra.apiUrl
 *   3. sandbox backend (Backend B — never the canonical Backend A by default)
 */
const FALLBACK_API_URL = 'https://caisse-backend-production.up.railway.app';

export function apiBaseUrl(): string {
  const fromEnv = process.env.EXPO_PUBLIC_API_URL;
  const fromExtra = (Constants.expoConfig?.extra as { apiUrl?: string } | undefined)
    ?.apiUrl;
  const base = fromEnv || fromExtra || FALLBACK_API_URL;
  return `${base.replace(/\/+$/, '')}/api`;
}

export const APP_VERSION = Constants.expoConfig?.version ?? '0.0.0';
