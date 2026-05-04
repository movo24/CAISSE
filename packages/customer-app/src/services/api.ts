import axios from 'axios';
import { Preferences } from '@capacitor/preferences';

const API_URL =
  import.meta.env.VITE_API_URL || 'https://api.addxintelligence.com';

const api = axios.create({
  baseURL: `${API_URL}/api/mobile`,
  timeout: 15000,
  headers: { 'Content-Type': 'application/json' },
});

// ── Token management (Capacitor Preferences for persistent storage) ──
const TOKEN_KEY = 'wesley.accessToken';
const REFRESH_KEY = 'wesley.refreshToken';

export async function getAccessToken(): Promise<string | null> {
  const { value } = await Preferences.get({ key: TOKEN_KEY });
  return value;
}

export async function setTokens(access: string, refresh: string): Promise<void> {
  await Preferences.set({ key: TOKEN_KEY, value: access });
  await Preferences.set({ key: REFRESH_KEY, value: refresh });
}

export async function clearTokens(): Promise<void> {
  await Preferences.remove({ key: TOKEN_KEY });
  await Preferences.remove({ key: REFRESH_KEY });
}

// Inject token in every request
api.interceptors.request.use(async (config) => {
  const token = await getAccessToken();
  if (token && !config.headers.Authorization) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Auto-refresh on 401
let isRefreshing = false;
let queue: Array<(token: string) => void> = [];

api.interceptors.response.use(
  (r) => r,
  async (error) => {
    const original = error.config;
    if (
      error.response?.status === 401 &&
      !original._retry &&
      !original.url?.includes('/auth/')
    ) {
      original._retry = true;

      if (isRefreshing) {
        return new Promise((resolve) => {
          queue.push((token: string) => {
            original.headers.Authorization = `Bearer ${token}`;
            resolve(api(original));
          });
        });
      }

      isRefreshing = true;
      try {
        const { value: refreshToken } = await Preferences.get({ key: REFRESH_KEY });
        if (!refreshToken) throw new Error('no refresh');
        const res = await axios.post(`${API_URL}/api/mobile/auth/refresh`, { refreshToken });
        await setTokens(res.data.accessToken, res.data.refreshToken);
        queue.forEach((cb) => cb(res.data.accessToken));
        queue = [];
        original.headers.Authorization = `Bearer ${res.data.accessToken}`;
        return api(original);
      } catch (err) {
        await clearTokens();
        queue = [];
        window.location.hash = '/login';
        return Promise.reject(err);
      } finally {
        isRefreshing = false;
      }
    }
    return Promise.reject(error);
  },
);

// ── API surface ──

export const authApi = {
  register: (data: {
    email: string;
    password: string;
    firstName?: string;
    preferredStoreId?: string;
  }) => api.post('/auth/register', data).then((r) => r.data),

  login: (email: string, password: string) =>
    api.post('/auth/login', { email, password }).then((r) => r.data),

  logout: () => api.post('/auth/logout'),
};

export const meApi = {
  get: () => api.get('/me').then((r) => r.data),
  update: (data: { firstName?: string; preferredStoreId?: string }) =>
    api.patch('/me', data).then((r) => r.data),
  delete: () => api.delete('/me').then((r) => r.data),
};

export const loyaltyApi = {
  /** Returns publicCode, qrToken (60s TTL), activeCoupon, nextReward */
  getCard: () => api.get('/loyalty-card').then((r) => r.data),
  rotateQr: () => api.post('/loyalty-card/regenerate-qr').then((r) => r.data),
};

export const couponApi = {
  list: (status?: 'AVAILABLE' | 'USED' | 'ALL') =>
    api.get('/coupons', { params: { status } }).then((r) => r.data),
  active: () => api.get('/coupons/active').then((r) => r.data),
  history: () => api.get('/coupons/history').then((r) => r.data),
};

export default api;
