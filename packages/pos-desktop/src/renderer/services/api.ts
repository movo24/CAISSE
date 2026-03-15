import axios from 'axios';

// In dev, Vite proxies /api → http://localhost:3001/api (see vite.config.ts)
// This avoids mixed-content issues when serving over HTTPS (iPad camera needs HTTPS)
// In production, the API is served from the same origin
const API_URL = (import.meta as any).env?.VITE_API_URL || '';

const api = axios.create({
  baseURL: `${API_URL}/api`,
  headers: { 'Content-Type': 'application/json' },
});

// ── JWT expiry helper ──
function isTokenExpired(token: string): boolean {
  try {
    const payload = JSON.parse(atob(token.split('.')[1]));
    // Add 30s buffer to avoid using a token that's about to expire
    return payload.exp * 1000 < Date.now() + 30000;
  } catch {
    return true; // Malformed token = expired
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

// Attach JWT token to requests (with expiry pre-check)
api.interceptors.request.use(async (config) => {
  // Skip auth header for login/refresh endpoints
  const url = config.url || '';
  if (url.includes('/auth/login') || url.includes('/auth/refresh')) {
    return config;
  }

  let token = localStorage.getItem('accessToken');

  // If token is expired, try to refresh before sending the request
  if (token && isTokenExpired(token)) {
    if (!isRefreshing) {
      isRefreshing = true;
      const newToken = await tryRefreshToken();
      isRefreshing = false;
      if (newToken) {
        token = newToken;
        onRefreshed(newToken);
      } else {
        // Refresh failed — clear tokens, redirect to login
        localStorage.removeItem('accessToken');
        localStorage.removeItem('refreshToken');
        window.location.href = '/login';
        return config;
      }
    } else {
      // Wait for the ongoing refresh to complete
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

// Handle 401 responses — clear tokens and redirect
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    if (error.response?.status === 401) {
      // Try refresh one more time if we haven't already
      const refreshToken = localStorage.getItem('refreshToken');
      if (refreshToken && !isTokenExpired(refreshToken) && !error.config._retry) {
        error.config._retry = true;
        const newToken = await tryRefreshToken();
        if (newToken) {
          error.config.headers.Authorization = `Bearer ${newToken}`;
          return api(error.config);
        }
      }

      // Refresh failed or no refresh token — force logout
      localStorage.removeItem('accessToken');
      localStorage.removeItem('refreshToken');
      localStorage.removeItem('employee');
      // Only redirect in browser context (not during sync)
      if (typeof window !== 'undefined' && window.location) {
        window.location.href = '/login';
      }
    }
    return Promise.reject(error);
  },
);

// Auth
export const authApi = {
  loginPin: (storeId: string, pin: string) =>
    api.post('/auth/login/pin', { storeId, pin }),
  loginQr: (qrCode: string, pin: string) =>
    api.post('/auth/login/qr', { qrCode, pin }),
  logout: () => api.post('/auth/logout'),
};

// Stores
export const storesApi = {
  getMyInfo: () => api.get('/stores/me/info'),
  getMy: () => api.get('/stores/me'),
};

// Products
export const productsApi = {
  list: () => api.get('/products'),
  scan: (ean: string) => api.get(`/products/scan/${ean}`),
  create: (data: any) => api.post('/products', data),
  update: (id: string, data: any) => api.put(`/products/${id}`, data),
  stockAlerts: () => api.get('/products/stock-alerts'),
  categories: () => api.get('/products/categories'),
};

// Sales
export const salesApi = {
  create: (data: any) => api.post('/sales', data),
  list: (date?: string) => api.get('/sales', { params: { date } }),
  get: (id: string) => api.get(`/sales/${id}`),
  void: (id: string) => api.post(`/sales/${id}/void`),
};

// Customers
export const customersApi = {
  create: (data: any) => api.post('/customers', data),
  list: () => api.get('/customers'),
  findByQr: (qrCode: string) => api.get(`/customers/qr/${qrCode}`),
  verify: (id: string, otpCode: string) =>
    api.post(`/customers/${id}/verify`, { otpCode }),
};

// Reports
export const reportsApi = {
  generateZReport: (date: string) =>
    api.post('/reports/z-report', null, { params: { date } }),
  getZReport: (date: string) =>
    api.get('/reports/z-report', { params: { date } }),
};

// Promotions
export const promosApi = {
  list: () => api.get('/promotions'),
  active: () => api.get('/promotions/active'),
};

// Occupancy
export const occupancyApi = {
  get: (storeId: string) => api.get(`/occupancy/${storeId}`),
  getWeather: (storeId: string) => api.get(`/occupancy/${storeId}/weather`),
};

// Weather (new enriched module)
export const weatherApi = {
  get: (storeId: string) => api.get(`/weather/${storeId}`),
  getSimple: (storeId: string) => api.get(`/weather/${storeId}/simple`),
  getSnapshot: (storeId: string) => api.get(`/weather/${storeId}/snapshot`),
};

// Jackpot
export const jackpotApi = {
  getConfig: () => api.get('/jackpot/config'),
  updateConfig: (data: any) => api.put('/jackpot/config', data),
  createConfig: (data: any) => api.post('/jackpot/config', data),
  getStatus: () => api.get('/jackpot/status'),
  getHistory: (limit?: number) =>
    api.get('/jackpot/history', { params: { limit } }),
};

// Rights
export const rightsApi = {
  getMyRights: () => api.get('/employees/me/rights'),
  getRoleDefaults: () => api.get('/employees/rights/defaults'),
};

// Pointage
export const pointageApi = {
  recordPunch: (data: any) => api.post('/pointage/punch', data),
  getTodayPunches: (employeeId: string) => api.get(`/pointage/today/${employeeId}`),
};

// Planning
export const planningApi = {
  getMyWeek: () => api.get('/planning/me/week'),
  getMyMonth: (month: string) => api.get('/planning/me/month', { params: { month } }),
};

// Performance Caissier
export const performanceApi = {
  submitSession: (data: any) => api.post('/performance/session', data),
  getMyStats: (period?: string) => api.get('/performance/me', { params: { period } }),
};

// Staffing IA
export const staffingApi = {
  submitSnapshot: (data: any) => api.post('/staffing/snapshot', data),
  getTargets: (storeId: string) => api.get(`/staffing/targets/${storeId}`),
  getHistory: (storeId: string, date?: string) => api.get(`/staffing/history/${storeId}`, { params: { date } }),
};

// Live Performance (Network comparison)
export const livePerformanceApi = {
  compact: () => api.get('/live-performance/compact'),
  insight: () => api.get('/live-performance/insight'),
};

export default api;
