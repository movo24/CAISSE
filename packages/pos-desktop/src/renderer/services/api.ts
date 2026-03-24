import axios from 'axios';

// In dev, Vite proxies /api → http://localhost:3001/api (see vite.config.ts)
// This avoids mixed-content issues when serving over HTTPS (iPad camera needs HTTPS)
// In production, the API is served from the same origin
const API_URL = (import.meta as any).env?.VITE_API_URL || '';

const api = axios.create({
  baseURL: `${API_URL}/api`,
  headers: {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-cache, no-store, must-revalidate',
    'Pragma': 'no-cache',
  },
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
        // Refresh failed — clear tokens, let ProtectedRoute redirect
        localStorage.removeItem('accessToken');
        localStorage.removeItem('refreshToken');
        localStorage.removeItem('pos_employee');
        return Promise.reject(new Error('Session expired'));
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
    const url = error.config?.url || '';
    // Never redirect on auth endpoints — let the caller handle auth errors
    if (url.includes('/auth/login') || url.includes('/auth/refresh')) {
      return Promise.reject(error);
    }

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
      localStorage.removeItem('pos_employee');
      // Don't hard redirect — let ProtectedRoute handle it via React router
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

// ── RH APIs REMOVED — All managed by TimeWin24 ──
// rightsApi, pointageApi, planningApi, performanceApi, staffingApi, livePerformanceApi

// TimeWin24 Proxy
export const timewinApi = {
  health: () => api.get('/timewin/health'),
  clockIn: (employeeId: string, storeId: string) => api.post('/timewin/clock-in', { employeeId, storeId }),
  clockOut: (employeeId: string, storeId: string) => api.post('/timewin/clock-out', { employeeId, storeId }),
  pushEvent: (data: { storeId: string; eventType: string; employeeId?: string; data?: any }) =>
    api.post('/timewin/events', data),
  todayShifts: (storeId: string) => api.get('/timewin/today-shifts', { params: { storeId } }),
};

// Terminals (WisePad 3 / reader management)
export const terminalsApi = {
  list: () => api.get('/terminals'),
  create: (data: { label: string; deviceType: string; serialNumber?: string; registrationCode?: string }) =>
    api.post('/terminals', data),
  update: (id: string, data: { label?: string; isActive?: boolean }) =>
    api.patch(`/terminals/${id}`, data),
  heartbeat: (id: string, data: { status: string; batteryLevel?: number }) =>
    api.post(`/terminals/${id}/heartbeat`, data),
};

// Stripe Terminal (in-store card payments)
export const stripeTerminalApi = {
  connectionToken: () => api.post('/stripe-terminal/connection-token'),
  createPaymentIntent: (data: { amount: number; ticketNumber: string; currency?: string; description?: string }) =>
    api.post('/stripe-terminal/payment-intent', data),
  getPaymentIntent: (id: string) => api.get(`/stripe-terminal/payment-intent/${id}`),
  cancelPaymentIntent: (id: string) => api.post(`/stripe-terminal/payment-intent/${id}/cancel`),
};

export default api;
