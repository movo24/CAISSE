import axios from 'axios';

import { API_URL } from '../utils/apiConfig';

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
        onRefreshFailed(new Error('Token refresh failed'));
        localStorage.removeItem('accessToken');
        localStorage.removeItem('refreshToken');
        localStorage.removeItem('pos_employee');
        delete config.headers.Authorization;
        return Promise.reject(new Error('Session expired'));
      }
    } else {
      try {
        token = await new Promise<string>((resolve, reject) => {
          refreshSubscribers.push({ resolve, reject });
        });
      } catch {
        delete config.headers.Authorization;
        return Promise.reject(new Error('Session expired'));
      }
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
  get: (id: string) => api.get(`/products/${id}`),
  scan: (ean: string) => api.get(`/products/scan/${ean}`),
  create: (data: any) => api.post('/products', data),
  update: (id: string, data: any) => api.put(`/products/${id}`, data),
  stockAlerts: () => api.get('/products/stock-alerts'),
  categories: () => api.get('/products/categories'),
};

// Sales
export const salesApi = {
  // idempotencyKey: stable per offline-queue entry, so a sync replay is deduped server-side
  create: (data: any, idempotencyKey?: string) =>
    api.post('/sales', data, idempotencyKey ? { headers: { 'Idempotency-Key': idempotencyKey } } : undefined),
  list: (date?: string) => api.get('/sales', { params: { date } }),
  get: (id: string) => api.get(`/sales/${id}`),
  void: (id: string, idempotencyKey?: string) =>
    api.post(`/sales/${id}/void`, undefined, idempotencyKey ? { headers: { 'Idempotency-Key': idempotencyKey } } : undefined),
};

// Receipts (digital ticket)
export const receiptsApi = {
  email: (saleId: string, email: string) =>
    api.post(`/receipts/${saleId}/email`, { email }),
};

// Returns / credit notes (avoirs) — online only (needs the server-side sale)
export const returnsApi = {
  listSales: (date: string) => api.get('/sales', { params: { date } }),
  returnable: (saleId: string) => api.get(`/returns/sale/${saleId}/returnable`),
  lookupCreditNote: (code: string) => api.get(`/returns/credit-note/${encodeURIComponent(code)}`),
  createByTicket: (
    data: { ticketNumber: string; items: { ean: string; quantity: number }[]; reason?: string; refundMethod: 'cash' | 'card' | 'store_credit' },
    idempotencyKey: string,
  ) => api.post('/returns/by-ticket', data, { headers: { 'Idempotency-Key': idempotencyKey } }),
  create: (
    data: {
      originalSaleId: string;
      items: { lineItemId: string; quantity: number }[];
      reason?: string;
      refundMethod: 'cash' | 'card' | 'store_credit';
    },
    idempotencyKey: string,
  ) => api.post('/returns', data, { headers: { 'Idempotency-Key': idempotencyKey } }),
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
// P322 (cycle I5) — POS sessions: cash summary for the till count (POS-017b).
// Ready-to-wire: the POS has no session open/close UI yet (product/UX decision) —
// this client + lib/cash-count.ts are the API side, tested and waiting.
export const posSessionsApi = {
  active: (terminalId: string) =>
    api.get('/pos-sessions/active', { headers: { 'X-Terminal-Id': terminalId } }),
  cashSummary: (sessionId: string) => api.get(`/pos-sessions/${sessionId}/cash-summary`),
  close: (sessionId: string) => api.post(`/pos-sessions/${sessionId}/close`),
};

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
  storeConfig: (storeId: string) => api.get('/timewin/store-config', { params: { storeId } }),
  getStoreSchedule: (storeId: string) => api.get('/timewin/store-schedule', { params: { storeId } }),
  updateStoreSchedule: (storeId: string, schedules: any[]) =>
    api.put('/timewin/store-schedule', { schedules }, { params: { storeId } }),
  stores: () => api.get('/timewin/stores'),
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

// Sales AI (recommendations, associations, patterns)
export const salesAiApi = {
  recommendations: (cartProductIds?: string[]) =>
    api.get('/sales-ai/recommendations', { params: cartProductIds?.length ? { cartProductIds: cartProductIds.join(',') } : {} }),
  associations: () => api.get('/sales-ai/associations'),
  hourlyPatterns: () => api.get('/sales-ai/hourly-patterns'),
  stats: () => api.get('/sales-ai/stats'),
  // Learning endpoints — track reco funnel
  logDisplay: (data: { triggerProductId: string; triggerProductName: string; suggestedProductId: string; suggestedProductName: string; confidence: number; estimatedCashImpact: number; marginPercent: number }) =>
    api.post('/sales-ai/log/display', data),
  logClick: (logId: string) => api.patch(`/sales-ai/log/${logId}/click`),
  logAddToCart: (logId: string) => api.patch(`/sales-ai/log/${logId}/add-to-cart`),
  logConversion: (logId: string, data: { saleId: string; revenueGenerated: number; marginGenerated: number }) =>
    api.patch(`/sales-ai/log/${logId}/convert`, data),
  kpi: () => api.get('/sales-ai/kpi'),
};

// ── Sales Guards (anti-error, evaluated before payment) ──
export interface SaleGuardItemInput {
  productId: string;
  ean?: string;
  quantity: number;
  sellPriceMinorUnits?: number;
  discountMinorUnits?: number;
}
export const salesGuardsApi = {
  /** Evaluate the current cart. Server enriches cost/catalogue. Fail-open on the client. */
  evaluate: (
    data: {
      items: SaleGuardItemInput[];
      saleId?: string;
      freeProductUsageCount?: number;
      cancellationCount?: number;
    },
    signal?: AbortSignal,
  ) => api.post('/sales-guards/evaluate', data, { signal }),
};

// ── Wesley Club loyalty (POS endpoints) ──
export const loyaltyApi = {
  /** Resolve QR token → customer info + available coupon (read-only) */
  scan: (data: { qrToken: string; storeId: string; terminalId: string; ticketDraftId?: string }) =>
    api.post('/pos/loyalty/scan', data).then((r) => r.data),

  /** Redeem coupon (transactional, idempotent). MUST pass X-Idempotency-Key. */
  redeem: (
    data: {
      customerId: string;
      couponId: string;
      storeId: string;
      terminalId?: string;
      ticketId: string;
      ticketAmountCents: number;
    },
    idempotencyKey: string,
  ) =>
    api
      .post('/pos/loyalty/redeem', data, {
        headers: { 'X-Idempotency-Key': idempotencyKey },
      })
      .then((r) => r.data),

  /** Record a visit (no coupon redeemed) */
  visit: (data: {
    customerId: string;
    storeId: string;
    terminalId?: string;
    ticketId?: string;
    purchaseAmountCents?: number;
  }) => api.post('/pos/loyalty/visit', data).then((r) => r.data),
};

export default api;
