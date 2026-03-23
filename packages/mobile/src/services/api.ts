// ── Mobile API Service ───────────────────────────────────────────
// Axios instance + JWT interceptors + auto-refresh
//
// Fixed race conditions:
// - Only ONE refresh can be in flight at a time (request + response interceptors share lock)
// - Queued subscribers are drained on both success AND failure
// - 401 response interceptor checks isRefreshing before triggering a new refresh
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
        return config;
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
  categories: () => api.get('/products/categories'),
  createCategory: (name: string) => api.post('/products/categories', { name }),
  create: (data: {
    ean: string;
    name: string;
    priceMinorUnits: number;
    costMinorUnits?: number;
    categoryId?: string;
    taxRate?: number;
    stockQuantity?: number;
    stockAlertThreshold?: number;
    description?: string;
    imageUrl?: string;
  }) => api.post('/products', data),
  /** Update product fields (including imageUrl for photo) */
  update: (id: string, data: Record<string, unknown>) =>
    api.put(`/products/${id}`, data),
};

export const stockApi = {
  alerts: () => api.get('/stock/alerts'),
  /** Adjust stock — mode: 'absolute' sets to exact value, 'delta' adds/subtracts */
  adjust: (productId: string, data: { quantity: number; reason: string; mode?: 'absolute' | 'delta' }) =>
    api.post(`/stock/${productId}/adjust`, {
      quantity: Math.round(Number(data.quantity) || 0),
      reason: data.reason || 'ajustement_mobile',
      mode: data.mode || 'absolute',
    }),
};

export default api;
