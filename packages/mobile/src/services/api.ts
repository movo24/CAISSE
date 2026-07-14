// ── Mobile API Service ───────────────────────────────────────────
// Axios instance + JWT interceptors + auto-refresh
//
// Fixed race conditions:
// - Only ONE refresh can be in flight at a time (request + response interceptors share lock)
// - Queued subscribers are drained on both success AND failure
// - 401 response interceptor checks isRefreshing before triggering a new refresh
// ─────────────────────────────────────────────────────────────────

import axios from 'axios';

// API base URL: use VITE_API_URL if set, fallback to prod URL or empty (dev proxy).
const IS_PROD = typeof window !== 'undefined' && !window.location.hostname.includes('localhost');
const API_URL = import.meta.env.VITE_API_URL || (IS_PROD ? 'https://api.addxintelligence.com' : '');

const api = axios.create({
  baseURL: `${API_URL}/api`,
  timeout: 15000,
  headers: {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-cache, no-store, must-revalidate',
    'Pragma': 'no-cache',
  },
});

// ── JWT expiry helper ──

function isTokenExpired(token: string): boolean {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return true;
    const payload = JSON.parse(atob(parts[1]));
    if (!payload || typeof payload.exp !== 'number') return true;
    return payload.exp * 1000 < Date.now() + 30000;
  } catch {
    return true;
  }
}

// ── Token refresh logic ──
// Single refresh gate: both request and response interceptors use this

let isRefreshing = false;
let refreshSubscribers: Array<{
  resolve: (token: string) => void;
  reject: (err: Error) => void;
}> = [];

function onRefreshed(token: string) {
  refreshSubscribers.forEach((sub) => sub.resolve(token));
  refreshSubscribers = [];
}

function onRefreshFailed(err: Error) {
  refreshSubscribers.forEach((sub) => sub.reject(err));
  refreshSubscribers = [];
}

async function tryRefreshToken(): Promise<string | null> {
  const refreshToken = localStorage.getItem('refreshToken');
  if (!refreshToken || isTokenExpired(refreshToken)) return null;

  try {
    const res = await axios.post(`${API_URL}/api/auth/refresh`, { refreshToken });
    const { accessToken, refreshToken: newRefresh } = res.data;
    localStorage.setItem('accessToken', accessToken);
    localStorage.setItem('refreshToken', newRefresh);
    return accessToken;
  } catch {
    return null;
  }
}

function redirectToLogin() {
  localStorage.removeItem('accessToken');
  localStorage.removeItem('refreshToken');
  localStorage.removeItem('employee');
  localStorage.removeItem('storeInfo');
  // Don't hard redirect — ProtectedRoute handles it via React router
}

// ── Request interceptor: attach JWT, proactively refresh if expired ──

api.interceptors.request.use(async (config) => {
  const url = config.url || '';
  if (url.includes('/auth/login') || url.includes('/auth/refresh')) {
    return config;
  }

  let token = localStorage.getItem('accessToken');

  if (token && isTokenExpired(token)) {
    if (!isRefreshing) {
      isRefreshing = true;
      const newToken = await tryRefreshToken();
      isRefreshing = false;
      if (newToken) {
        token = newToken;
        onRefreshed(newToken);
      } else {
        onRefreshFailed(new Error('Token refresh failed'));
        redirectToLogin();
        delete config.headers.Authorization;
        return Promise.reject(new Error('Session expired'));
      }
    } else {
      // Another refresh is already in flight — wait for it
      try {
        token = await new Promise<string>((resolve, reject) => {
          refreshSubscribers.push({ resolve, reject });
        });
      } catch {
        // Refresh failed — redirect handled by the initiating caller
        return Promise.reject(new Error('Session expired'));
      }
    }
  }

  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// ── Response interceptor: retry on 401 ──

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    if (error.response?.status === 401 && !error.config?._retry) {
      error.config._retry = true;

      // Check if a refresh is already happening — if so, wait for it
      if (isRefreshing) {
        try {
          const newToken = await new Promise<string>((resolve, reject) => {
            refreshSubscribers.push({ resolve, reject });
          });
          error.config.headers.Authorization = `Bearer ${newToken}`;
          return api(error.config);
        } catch {
          // Refresh failed
          return Promise.reject(error);
        }
      }

      // Try to refresh ourselves
      const refreshToken = localStorage.getItem('refreshToken');
      if (refreshToken && !isTokenExpired(refreshToken)) {
        isRefreshing = true;
        const newToken = await tryRefreshToken();
        isRefreshing = false;

        if (newToken) {
          onRefreshed(newToken);
          error.config.headers.Authorization = `Bearer ${newToken}`;
          return api(error.config);
        }
      }

      // Refresh failed — drain queue, redirect
      onRefreshFailed(new Error('Session expired'));
      redirectToLogin();
    }
    return Promise.reject(error);
  },
);


// ── API groups — STRICTEMENT LECTURE SEULE ───────────────────────
// Règle absolue (P366) : l'application observe, compare
// et analyse — elle ne commande RIEN. En dehors de l'authentification
// (login/refresh/logout + passkeys WebAuthn P370), ce client n'expose
// QUE des GET. Ajouter un
// POST/PUT/PATCH/DELETE métier ici est une violation de conception.
// ─────────────────────────────────────────────────────────────────

/** P370 — Passkeys WebAuthn (périmètre AUTH, comme login/refresh/logout).
 *  Aucune credential côté client : options + réponses signées uniquement. */
export const webauthnApi = {
  registerOptions: () => api.post('/auth/webauthn/register/options'),
  registerVerify: (body: { response: unknown; deviceName: string }) =>
    api.post('/auth/webauthn/register/verify', body),
  loginOptions: () => api.post('/auth/webauthn/login/options'),
  loginVerify: (body: { challengeId: string; response: unknown }) =>
    api.post('/auth/webauthn/login/verify', body),
  credentials: () => api.get('/auth/webauthn/credentials'),
  rename: (id: string, name: string) =>
    api.patch(`/auth/webauthn/credentials/${encodeURIComponent(id)}`, { name }),
  revoke: (id: string) => api.delete(`/auth/webauthn/credentials/${encodeURIComponent(id)}`),
};

export const authApi = {
  /** Auth CENTRALE du dashboard The Wesley (email + code d'accès).
   *  Le rôle et le périmètre sont déterminés côté serveur. */
  loginEmail: (email: string, pin: string) =>
    api.post('/auth/login/admin', { email, pin }),
  refreshToken: (refreshToken: string) =>
    api.post('/auth/refresh', { refreshToken }),
  logout: () => api.post('/auth/logout'),
};

/** POS-110 — alertes de supervision lecture seule (manager/admin). */
export const cockpitApi = {
  alerts: () => api.get('/mobile/v1/alerts'),
};

/** P366 — analytics réseau lecture seule (manager/admin, GET uniquement). */
export const analyticsApi = {
  overview: (params: Record<string, string | undefined>) =>
    api.get('/mobile/v1/analytics/overview', { params }),
  revenueWindows: (params: Record<string, string | undefined>) =>
    api.get('/mobile/v1/analytics/revenue-windows', { params }),
  stores: (params: Record<string, string | undefined>) =>
    api.get('/mobile/v1/analytics/stores', { params }),
  storeDetail: (id: string, params: Record<string, string | undefined>) =>
    api.get(`/mobile/v1/analytics/stores/${encodeURIComponent(id)}`, { params }),
  products: (params: Record<string, string | undefined>) =>
    api.get('/mobile/v1/analytics/products', { params }),
  catalog: (params: Record<string, string | undefined>) =>
    api.get('/mobile/v1/analytics/catalog', { params }),
  productDetail: (ean: string, params: Record<string, string | undefined>) =>
    api.get(`/mobile/v1/analytics/products/${encodeURIComponent(ean)}`, { params }),
  categories: (params: Record<string, string | undefined>) =>
    api.get('/mobile/v1/analytics/categories', { params }),
  heatmap: (params: Record<string, string | undefined>) =>
    api.get('/mobile/v1/analytics/heatmap', { params }),
  compare: (params: Record<string, string | undefined>) =>
    api.get('/mobile/v1/analytics/compare', { params }),
  series: (params: Record<string, string | undefined>) =>
    api.get('/mobile/v1/analytics/series', { params }),
  productsMatrix: (params: Record<string, string | undefined>) =>
    api.get('/mobile/v1/analytics/products-matrix', { params }),
};

/** Liste des magasins accessibles (référentiel, lecture seule). */
export const storesApi = {
  accessible: () => api.get('/stores/accessible'),
};

export default api;
