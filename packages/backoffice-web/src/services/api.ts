import axios from 'axios';

const API_URL = (import.meta as any).env?.VITE_API_URL || 'http://localhost:3001';

const api = axios.create({
  baseURL: `${API_URL}/api`,
  headers: { 'Content-Type': 'application/json' },
});

// ── JWT expiry helper ──
function isTokenExpired(token: string): boolean {
  try {
    const payload = JSON.parse(atob(token.split('.')[1]));
    return payload.exp * 1000 < Date.now() + 30000;
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

// Attach JWT token to requests (with expiry pre-check)
api.interceptors.request.use(async (config) => {
  const url = config.url || '';
  if (url.includes('/auth/login') || url.includes('/auth/refresh')) return config;

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
        localStorage.removeItem('employee');
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

// Handle 401 — attempt refresh, then redirect to login
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const url = error.config?.url || '';
    // Never redirect on auth endpoints — let the caller handle auth errors
    if (url.includes('/auth/login') || url.includes('/auth/refresh')) {
      return Promise.reject(error);
    }

    if (error.response?.status === 401 && !error.config._retry) {
      error.config._retry = true;
      const newToken = await tryRefreshToken();
      if (newToken) {
        error.config.headers.Authorization = `Bearer ${newToken}`;
        return api(error.config);
      }
      localStorage.removeItem('accessToken');
      localStorage.removeItem('refreshToken');
      localStorage.removeItem('employee');
      // Don't redirect if already on login page
      if (!window.location.pathname.startsWith('/login') && window.location.pathname !== '/') {
        window.location.href = '/login';
      }
    }
    return Promise.reject(error);
  },
);

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------
export const authApi = {
  loginPin: (storeId: string, pin: string) =>
    api.post('/auth/login/pin', { storeId, pin }),
  loginQr: (qrCode: string, pin: string) =>
    api.post('/auth/login/qr', { qrCode, pin }),
  refreshToken: (refreshToken: string) =>
    api.post('/auth/refresh', { refreshToken }),
  logout: () => api.post('/auth/logout'),
};

// ---------------------------------------------------------------------------
// Products
// ---------------------------------------------------------------------------
export const productsApi = {
  list: (storeId?: string) =>
    api.get('/products', { params: { storeId } }),
  get: (id: string) => api.get(`/products/${id}`),
  create: (data: any) => api.post('/products', data),
  update: (id: string, data: any) => api.put(`/products/${id}`, data),
  delete: (id: string) => api.delete(`/products/${id}`),
  scan: (ean: string) => api.get(`/products/scan/${ean}`),
  stockAlerts: () => api.get('/products/stock-alerts'),
  priceHistory: (id: string) => api.get(`/products/${id}/price-history`),
};

// ---------------------------------------------------------------------------
// Sales
// ---------------------------------------------------------------------------
export const salesApi = {
  list: (date?: string) => api.get('/sales', { params: { date } }),
  get: (id: string) => api.get(`/sales/${id}`),
  void: (id: string) => api.post(`/sales/${id}/void`),
};

// ---------------------------------------------------------------------------
// Customers
// ---------------------------------------------------------------------------
export const customersApi = {
  list: () => api.get('/customers'),
  get: (id: string) => api.get(`/customers/${id}`),
  create: (data: any) => api.post('/customers', data),
  update: (id: string, data: any) => api.put(`/customers/${id}`, data),
  findByQr: (qrCode: string) => api.get(`/customers/qr/${qrCode}`),
};

// ---------------------------------------------------------------------------
// Employees
// ---------------------------------------------------------------------------
export const employeesApi = {
  list: () => api.get('/employees'),
  get: (id: string) => api.get(`/employees/${id}`),
  create: (data: any) => api.post('/employees', data),
  update: (id: string, data: any) => api.put(`/employees/${id}`, data),
  deactivate: (id: string) => api.post(`/employees/${id}/deactivate`),
  generateQr: (id: string) => api.get(`/employees/${id}/qr-image`),
};

// ---------------------------------------------------------------------------
// Stores
// ---------------------------------------------------------------------------
export const storesApi = {
  list: (filters?: { organizationId?: string; unitId?: string }) =>
    api.get('/stores', { params: filters }),
  get: (id: string) => api.get(`/stores/${id}`),
  create: (data: Record<string, unknown>) => api.post('/stores', data),
  update: (id: string, data: any) => api.put(`/stores/${id}`, data),
  archive: (id: string) => api.patch(`/stores/${id}/archive`),
  reactivate: (id: string) => api.patch(`/stores/${id}/reactivate`),
  activate: (id: string) => api.post(`/stores/${id}/activate`),
  deactivate: (id: string) => api.post(`/stores/${id}/deactivate`),
  hardDelete: (id: string) => api.delete(`/stores/${id}`),
};

// ---------------------------------------------------------------------------
// Inventory Scans
// ---------------------------------------------------------------------------
export const inventoryScansApi = {
  record: (data: { barcode: string; quantity?: number; scanType?: string; sessionId?: string }) =>
    api.post('/inventory-scans', data),
  list: (filters?: { sessionId?: string; status?: string; scanType?: string; limit?: number }) =>
    api.get('/inventory-scans', { params: filters }),
  apply: (sessionId?: string) =>
    api.post('/inventory-scans/apply', { sessionId }),
  sessionStats: (sessionId: string) =>
    api.get(`/inventory-scans/session/${sessionId}/stats`),
};

// ---------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------
export const reportsApi = {
  generateZReport: (storeId: string, date: string) =>
    api.post('/reports/z-report', null, { params: { storeId, date } }),
  getZReport: (storeId: string, date: string) =>
    api.get('/reports/z-report', { params: { storeId, date } }),
  dailySummary: (storeId: string, date: string) =>
    api.get('/reports/daily-summary', { params: { storeId, date } }),
};

// ---------------------------------------------------------------------------
// Promotions
// ---------------------------------------------------------------------------
export const promosApi = {
  list: () => api.get('/promotions'),
  active: () => api.get('/promotions/active'),
  get: (id: string) => api.get(`/promotions/${id}`),
  create: (data: any) => api.post('/promotions', data),
  update: (id: string, data: any) => api.put(`/promotions/${id}`, data),
  delete: (id: string) => api.delete(`/promotions/${id}`),
};

// ---------------------------------------------------------------------------
// Stock
// ---------------------------------------------------------------------------
export const stockApi = {
  alerts: (storeId: string) =>
    api.get('/stock/alerts', { params: { storeId } }),
  adjust: (productId: string, data: { quantity: number; reason: string }) =>
    api.post(`/stock/${productId}/adjust`, data),
  updateDefaultThresholds: (data: { alertThreshold: number; criticalThreshold: number }) =>
    api.put('/stock/default-thresholds', data),
};

// ---------------------------------------------------------------------------
// Audit
// ---------------------------------------------------------------------------
export const auditApi = {
  list: (storeId: string, page = 1, limit = 50) =>
    api.get('/audit', { params: { storeId, page, limit } }),
  verify: (storeId: string) =>
    api.get('/audit/verify', { params: { storeId } }),
};

// ---------------------------------------------------------------------------
// IA / Intelligence
// ---------------------------------------------------------------------------
export const iaApi = {
  suggestPrice: (productId: string) =>
    api.get(`/ia/pricing/${productId}`),
  forecastRevenue: (targetDate: string) =>
    api.get('/ia/forecast', { params: { date: targetDate } }),
  // Claude AI endpoints
  chat: (data: { message: string; history?: { role: string; content: string }[] }) =>
    api.post('/ia/chat', data),
  generateReport: (data: { reportType: string; date?: string }) =>
    api.post('/ia/report', data),
};

// ---------------------------------------------------------------------------
// Currency
// ---------------------------------------------------------------------------
export const currencyApi = {
  rates: () => api.get('/currency/rates'),
  setRate: (data: {
    baseCurrency: string;
    quoteCurrency: string;
    rate: number;
    source: string;
  }) => api.post('/currency/rates', data),
  convert: (from: string, to: string, amountMinor: number) =>
    api.get('/currency/convert', { params: { from, to, amountMinor } }),
};

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------
export const notificationsApi = {
  summary: (storeId: string, inactiveDays?: number) =>
    api.get('/notifications/summary', {
      params: { storeId, inactiveDays },
    }),
  loyaltyReminders: (storeId: string, inactiveDays?: number) =>
    api.get('/notifications/loyalty-reminders', {
      params: { storeId, inactiveDays },
    }),
  stockAlerts: (storeId: string) =>
    api.get('/notifications/stock-alerts', { params: { storeId } }),
  sendQrReminder: (customerId: string, storeId: string) =>
    api.post(`/notifications/send-qr-reminder/${customerId}`, null, {
      params: { storeId },
    }),
};

// ---------------------------------------------------------------------------
// Sync
// ---------------------------------------------------------------------------
export const syncApi = {
  status: (storeId: string) =>
    api.get('/sync/status', { params: { storeId } }),
  pull: (storeId: string, lastSyncAt: string) =>
    api.get('/sync/pull', { params: { storeId, lastSyncAt } }),
};

// ---------------------------------------------------------------------------
// Rights (Droits & Permissions)
// ---------------------------------------------------------------------------
export const rightsApi = {
  getRoleDefaults: () => api.get('/employees/rights/defaults'),
  updateRoleDefaults: (role: string, data: any) =>
    api.put(`/employees/rights/defaults/${role}`, data),
  getEmployeeRights: (id: string) => api.get(`/employees/${id}/rights`),
  updateEmployeeRights: (id: string, data: any) =>
    api.put(`/employees/${id}/rights`, data),
};

// ---------------------------------------------------------------------------
// Pointage
// ---------------------------------------------------------------------------
export const pointageApi = {
  list: (params: { date?: string; employeeId?: string }) =>
    api.get('/pointage', { params }),
  liveStatus: (storeId: string) => api.get(`/pointage/live/${storeId}`),
  summary: (params: { employeeId?: string; startDate: string; endDate: string }) =>
    api.get('/pointage/summary', { params }),
  anomalies: (storeId: string, date?: string) =>
    api.get('/pointage/anomalies', { params: { storeId, date } }),
};

// ---------------------------------------------------------------------------
// Performance Caissier
// ---------------------------------------------------------------------------
export const performanceApi = {
  ranking: (params: { period?: string; storeId?: string }) =>
    api.get('/performance/ranking', { params }),
  cashierDetail: (employeeId: string, params: { period?: string }) =>
    api.get(`/performance/${employeeId}`, { params }),
  teamStats: (params: { period?: string; storeId?: string }) =>
    api.get('/performance/team', { params }),
  sessions: (employeeId: string, params: { startDate: string; endDate: string }) =>
    api.get(`/performance/${employeeId}/sessions`, { params }),
};

// ---------------------------------------------------------------------------
// Planning
// ---------------------------------------------------------------------------
export const planningApi = {
  getWeek: (params: { storeId?: string; weekStart: string }) =>
    api.get('/planning/week', { params }),
  getMonth: (params: { storeId?: string; month: string }) =>
    api.get('/planning/month', { params }),
  createShift: (data: any) => api.post('/planning/shifts', data),
  updateShift: (id: string, data: any) => api.put(`/planning/shifts/${id}`, data),
  deleteShift: (id: string) => api.delete(`/planning/shifts/${id}`),
  copyPreviousWeek: (params: { storeId: string; sourceWeek: string; targetWeek: string }) =>
    api.post('/planning/copy-week', params),
};

// ---------------------------------------------------------------------------
// Payroll (Paie)
// ---------------------------------------------------------------------------
export const payrollApi = {
  getMonthSummary: (params: { storeId?: string; month: string }) =>
    api.get('/payroll/summary', { params }),
  getEmployeePayslip: (employeeId: string, month: string) =>
    api.get(`/payroll/${employeeId}`, { params: { month } }),
  updateHourlyRate: (employeeId: string, data: { hourlyRateGross: number; contractHoursWeek: number }) =>
    api.put(`/payroll/${employeeId}/rate`, data),
  exportCSV: (params: { storeId?: string; month: string }) =>
    api.get('/payroll/export', { params, responseType: 'blob' }),
};

// ---------------------------------------------------------------------------
// Live Performance (Network comparison)
// ---------------------------------------------------------------------------
export const livePerformanceApi = {
  networkSnapshot: () => api.get('/live-performance/network'),
  compact: () => api.get('/live-performance/compact'),
  aiInsight: () => api.get('/live-performance/insight'),
};

// ---------------------------------------------------------------------------
// Organizations (Multi-entity hierarchy)
// ---------------------------------------------------------------------------
export const organizationsApi = {
  list: () => api.get('/organizations'),
  get: (id: string) => api.get(`/organizations/${id}`),
  create: (data: Record<string, unknown>) => api.post('/organizations', data),
  update: (id: string, data: Record<string, unknown>) => api.put(`/organizations/${id}`, data),
  deactivate: (id: string) => api.put(`/organizations/${id}/deactivate`),
};

// ---------------------------------------------------------------------------
// Units (Business units within an organization)
// ---------------------------------------------------------------------------
export const unitsApi = {
  list: (organizationId?: string) =>
    api.get('/units', { params: organizationId ? { organizationId } : {} }),
  get: (id: string) => api.get(`/units/${id}`),
  create: (data: Record<string, unknown>) => api.post('/units', data),
  update: (id: string, data: Record<string, unknown>) => api.put(`/units/${id}`, data),
  deactivate: (id: string) => api.put(`/units/${id}/deactivate`),
};

// ---------------------------------------------------------------------------
// Connected Apps
// ---------------------------------------------------------------------------
export const connectedAppsApi = {
  list: (organizationId: string) =>
    api.get('/connected-apps', { params: { organizationId } }),
  get: (id: string) => api.get(`/connected-apps/${id}`),
  create: (data: Record<string, unknown>) => api.post('/connected-apps', data),
  update: (id: string, data: Record<string, unknown>) => api.put(`/connected-apps/${id}`, data),
  deactivate: (id: string) => api.put(`/connected-apps/${id}/deactivate`),
};

// ---------------------------------------------------------------------------
// Subscriptions & Billing (Stripe)
// ---------------------------------------------------------------------------
export const subscriptionsApi = {
  plans: () => api.get('/subscriptions/plans'),
  get: (storeId: string) => api.get(`/subscriptions/${storeId}`),
  usage: (storeId: string) => api.get(`/subscriptions/${storeId}/usage`),
  changePlan: (storeId: string, data: { plan: string; billingCycle?: string }) =>
    api.post(`/subscriptions/${storeId}/change-plan`, data),
  cancel: (storeId: string) => api.post(`/subscriptions/${storeId}/cancel`),
  createCheckout: (storeId: string, data: { plan: string; billingCycle?: string; successUrl: string; cancelUrl: string }) =>
    api.post(`/subscriptions/${storeId}/checkout`, data),
  createPortal: (storeId: string, returnUrl: string) =>
    api.post(`/subscriptions/${storeId}/portal`, { returnUrl }),
};

export default api;
