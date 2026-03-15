// ── Mobile API Service ───────────────────────────────────────────
// Axios instance + JWT interceptors + auto-refresh
// Pattern from packages/pos-desktop/src/renderer/services/api.ts
// ─────────────────────────────────────────────────────────────────

import axios from 'axios';

const API_URL = (import.meta as any).env?.VITE_API_URL || '';

const api = axios.create({
  baseURL: `${API_URL}/api`,
  headers: { 'Content-Type': 'application/json' },
});

// ── JWT expiry helper ──

function isTokenExpired(token: string): boolean {
  try {
    const payload = JSON.parse(atob(token.split('.')[1]));
    return payload.exp * 1000 < Date.now() + 30000; // 30s buffer
  } catch {
    return true;
  }
}

// ── Token refresh logic ──

let isRefreshing = false;
let refreshSubscribers: ((token: string) => void)[] = [];

function onRefreshed(token: string) {
  refreshSubscribers.forEach((cb) => cb(token));
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

// ── Request interceptor: attach JWT ──

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
        localStorage.removeItem('accessToken');
        localStorage.removeItem('refreshToken');
        window.location.href = '/login';
        return config;
      }
    } else {
      token = await new Promise<string>((resolve) => {
        refreshSubscribers.push(resolve);
      });
    }
  }

  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// ── Response interceptor: 401 retry ──

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    if (error.response?.status === 401) {
      const refreshToken = localStorage.getItem('refreshToken');
      if (refreshToken && !isTokenExpired(refreshToken) && !error.config._retry) {
        error.config._retry = true;
        const newToken = await tryRefreshToken();
        if (newToken) {
          error.config.headers.Authorization = `Bearer ${newToken}`;
          return api(error.config);
        }
      }
      localStorage.removeItem('accessToken');
      localStorage.removeItem('refreshToken');
      localStorage.removeItem('employee');
      if (typeof window !== 'undefined' && window.location) {
        window.location.href = '/login';
      }
    }
    return Promise.reject(error);
  },
);

// ── API groups (mobile-specific subset) ──

export const authApi = {
  loginPin: (storeId: string, pin: string) =>
    api.post('/auth/login/pin', { storeId, pin }),
  refreshToken: (refreshToken: string) =>
    api.post('/auth/refresh', { refreshToken }),
  logout: () => api.post('/auth/logout'),
};

export const productsApi = {
  list: () => api.get('/products'),
  scan: (ean: string) => api.get(`/products/scan/${ean}`),
  get: (id: string) => api.get(`/products/${id}`),
};

export const stockApi = {
  alerts: () => api.get('/stock/alerts'),
  adjust: (productId: string, data: { quantity: number; reason: string }) =>
    api.post(`/stock/${productId}/adjust`, data),
};

export default api;
