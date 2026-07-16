import axios from 'axios';

// API base URL: use VITE_API_URL if set, otherwise relative (Vite proxy for dev).
const API_URL = import.meta.env.VITE_API_URL || '';

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
        onRefreshFailed(new Error('Token refresh failed'));
        localStorage.removeItem('accessToken');
        localStorage.removeItem('refreshToken');
        localStorage.removeItem('employee');
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
      // Soft logout — let ProtectedRoute handle redirect via React router
      localStorage.removeItem('accessToken');
      localStorage.removeItem('refreshToken');
      localStorage.removeItem('employee');
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
  loginAdmin: (email: string, pin: string) =>
    api.post('/auth/login/admin', { email, pin }),
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
  list: (params?: {
    storeId?: string;
    brandId?: string;
    supplierId?: string;
    categoryId?: string;
    status?: string;
    search?: string;
    sortBy?: string;
    sortDir?: 'ASC' | 'DESC';
    page?: number;
    limit?: number;
  }) => api.get('/products', { params }),
  get: (id: string) => api.get(`/products/${id}`),
  catalogStats: (params?: { storeId?: string }) => api.get('/products/catalog-stats', { params }),
  bulk: (data: {
    action: 'activate' | 'deactivate' | 'setCategory' | 'setSupplier' | 'setTax';
    productIds: string[];
    categoryId?: string;
    supplierId?: string;
    taxRate?: number;
  }) => api.post('/products/bulk', data),
  // Aligné sur CreateProductDto : ean+name+priceMinorUnits obligatoires, le
  // storeId est forcé serveur depuis le JWT (jamais envoyé par le client).
  create: (data: {
    ean: string;
    name: string;
    priceMinorUnits: number;
    stockQuantity?: number;
    categoryId?: string;
    description?: string;
    costMinorUnits?: number;
    taxRate?: number;
    sku?: string;
    brandId?: string;
    supplierId?: string;
    status?: string;
    oldPriceMinorUnits?: number;
    unitType?: string;
    imageUrl?: string;
    stockAlertThreshold?: number;
    stockCriticalThreshold?: number;
    shortName?: string;
    internalRef?: string;
    supplierRef?: string;
    productType?: string;
    countryOfOrigin?: string;
    leadTimeDays?: number;
    minOrderQuantity?: number;
    weightGrams?: number;
    widthMm?: number;
    heightMm?: number;
    depthMm?: number;
    volumeMl?: number;
    unitsPerCarton?: number;
  }) => api.post('/products', data),
  // Aligné sur UpdateProductDto : PAS de `ean` (immuable, absent du DTO →
  // rejeté par forbidNonWhitelisted), PAS de `storeId`.
  update: (
    id: string,
    data: {
      name?: string;
      priceMinorUnits?: number;
      stockQuantity?: number;
      categoryId?: string;
      description?: string;
      costMinorUnits?: number;
      taxRate?: number;
      sku?: string;
      brandId?: string | null;
      supplierId?: string | null;
      status?: string;
      oldPriceMinorUnits?: number | null;
      unitType?: string;
      imageUrl?: string;
      stockAlertThreshold?: number;
      stockCriticalThreshold?: number;
      shortName?: string;
      internalRef?: string;
      supplierRef?: string;
      productType?: string;
      countryOfOrigin?: string;
      leadTimeDays?: number;
      minOrderQuantity?: number;
      weightGrams?: number;
      widthMm?: number;
      heightMm?: number;
      depthMm?: number;
      volumeMl?: number;
      unitsPerCarton?: number;
      reason?: string;
      isActive?: boolean;
    },
  ) => api.put(`/products/${id}`, data),
  delete: (id: string) => api.delete(`/products/${id}`),
  scan: (ean: string) => api.get(`/products/scan/${ean}`),
  stockAlerts: () => api.get('/products/stock-alerts'),
  priceHistory: (id: string) => api.get(`/products/${id}/price-history`),
  changeLog: (id: string) => api.get(`/products/${id}/change-log`),
  priceAnalytics: (id: string) => api.get(`/products/${id}/price-analytics`),
  generateBarcode: (id: string) => api.post(`/products/${id}/generate-barcode`),
  duplicate: (id: string) => api.post(`/products/${id}/duplicate`),
  // Variants / SKU (decision 5)
  listVariants: (id: string) => api.get(`/products/${id}/variants`),
  createVariant: (id: string, data: { ean: string; variantName: string; priceMinorUnits: number; sku?: string; stockQuantity?: number; taxRate?: number; costMinorUnits?: number }) =>
    api.post(`/products/${id}/variants`, data),
  generateVariants: (id: string, data: { attributes: Array<{ name: string; values: string[] }>; priceMinorUnits?: number }) =>
    api.post(`/products/${id}/variants/generate`, data),
  // Per-store price override (decision 4)
  getStorePrice: (id: string) => api.get(`/products/${id}/store-price`),
  setStorePrice: (id: string, data: { priceMinorUnits: number; startsAt?: string; endsAt?: string }) => api.put(`/products/${id}/store-price`, data),
  clearStorePrice: (id: string) => api.delete(`/products/${id}/store-price`),
  // Brand / supplier (decision 3)
  listBrands: () => api.get('/products/brands'),
  createBrand: (name: string) => api.post('/products/brands', { name }),
  listSuppliers: () => api.get('/products/suppliers'),
  createSupplier: (name: string) => api.post('/products/suppliers', { name }),
  // Catégories hiérarchiques (Lot 1) — arbre id/name/parentId/productCount
  listCategories: () => api.get('/products/categories'),
  createCategory: (data: { name: string; parentId?: string | null }) =>
    api.post('/products/categories', data),
  updateCategory: (id: string, data: { name?: string; parentId?: string | null }) =>
    api.put(`/products/categories/${id}`, data),
  deleteCategory: (id: string) => api.delete(`/products/categories/${id}`),
  // CSV (Bloc 4i)
  exportCsv: () => api.get('/products/export', { responseType: 'text' }),
  importCsv: (csv: string) => api.post('/products/import', { csv }),
  // Product Packs — produits composés (GO owner 2026-07-09)
  listComponents: (id: string) => api.get(`/products/${id}/components`),
  addComponent: (id: string, data: { componentProductId: string; quantityPerParent: number }) =>
    api.post(`/products/${id}/components`, data),
  updateComponent: (id: string, componentRowId: string, data: { quantityPerParent?: number; isActive?: boolean }) =>
    api.put(`/products/${id}/components/${componentRowId}`, data),
  removeComponent: (id: string, componentRowId: string) =>
    api.delete(`/products/${id}/components/${componentRowId}`),
  // Produits liés (Lot E)
  listLinks: (id: string) => api.get(`/products/${id}/links`),
  addLink: (id: string, data: { linkedProductId: string; linkType?: string }) => api.post(`/products/${id}/links`, data),
  removeLink: (id: string, linkId: string) => api.delete(`/products/${id}/links/${linkId}`),
  // Fournisseurs multiples (Lot B)
  listProductSuppliers: (id: string) => api.get(`/products/${id}/suppliers`),
  addProductSupplier: (id: string, data: any) => api.post(`/products/${id}/suppliers`, data),
  updateProductSupplier: (id: string, rowId: string, data: any) => api.put(`/products/${id}/suppliers/${rowId}`, data),
  removeProductSupplier: (id: string, rowId: string) => api.delete(`/products/${id}/suppliers/${rowId}`),
  // Codes-barres multiples (Lot A)
  listBarcodes: (id: string) => api.get(`/products/${id}/barcodes`),
  addBarcode: (id: string, data: { barcode: string; type?: string; isPrimary?: boolean }) =>
    api.post(`/products/${id}/barcodes`, data),
  setPrimaryBarcode: (id: string, barcodeId: string) => api.put(`/products/${id}/barcodes/${barcodeId}/primary`),
  removeBarcode: (id: string, barcodeId: string) => api.delete(`/products/${id}/barcodes/${barcodeId}`),
  // Galerie & documents (Lot 4 — URLs externes)
  listMedia: (id: string) => api.get(`/products/${id}/media`),
  addMedia: (id: string, url: string, kind?: string) => api.post(`/products/${id}/media`, { url, kind }),
  setMediaKind: (id: string, mediaId: string, kind: string) => api.put(`/products/${id}/media/${mediaId}/kind`, { kind }),
  removeMedia: (id: string, mediaId: string) => api.delete(`/products/${id}/media/${mediaId}`),
  reorderMedia: (id: string, orderedIds: string[]) => api.put(`/products/${id}/media/reorder`, { orderedIds }),
  listDocuments: (id: string) => api.get(`/products/${id}/documents`),
  addDocument: (id: string, name: string, url: string) => api.post(`/products/${id}/documents`, { name, url }),
  removeDocument: (id: string, documentId: string) => api.delete(`/products/${id}/documents/${documentId}`),
  // Vues/filtres enregistrables côté serveur (P-D / M-G — /me/saved-filters)
  listSavedFilters: (page: string) => api.get('/me/saved-filters', { params: { page } }),
  saveFilter: (page: string, name: string, config: unknown) => api.post('/me/saved-filters', { page, name, config }),
  deleteSavedFilter: (id: string) => api.delete(`/me/saved-filters/${id}`),
};

// Intégration produit — scan code-barres inconnu (création sécurisée
// depuis Dashboard / Inventaire uniquement, jamais depuis la caisse)
export const productIntegrationApi = {
  scan: (barcode: string, source: 'dashboard' | 'inventory') =>
    api.get(`/product-integration/scan/${encodeURIComponent(barcode)}`, { params: { source } }),
  createRequest: (data: { barcode: string; source: 'dashboard' | 'inventory'; comment?: string; proposal?: any }) =>
    api.post('/product-integration/requests', data),
  listRequests: (status?: 'pending' | 'converted' | 'rejected') =>
    api.get('/product-integration/requests', { params: { status } }),
  authorize: (pin: string) => api.post('/product-integration/authorize', { pin }),
  createProduct: (data: any) => api.post('/product-integration/products', data),
  approveRequest: (id: string, data?: { overrides?: any; activate?: boolean }) =>
    api.post(`/product-integration/requests/${id}/approve`, data ?? {}),
  rejectRequest: (id: string, reason?: string) =>
    api.post(`/product-integration/requests/${id}/reject`, { reason }),
  listPendingProducts: () => api.get('/product-integration/products/pending'),
  activateProduct: (id: string) => api.post(`/product-integration/products/${id}/activate`, {}),
  rejectProduct: (id: string, reason?: string) =>
    api.post(`/product-integration/products/${id}/reject`, { reason }),
};

// Promo codes (decision 6)
export const promoCodesApi = {
  list: () => api.get('/promo-codes'),
  create: (data: { code: string; discountType: 'percentage' | 'fixed'; discountValue: number; startsAt?: string; endsAt?: string; maxUses?: number; productId?: string; categoryId?: string }) =>
    api.post('/promo-codes', data),
  validate: (code: string, ctx?: { productId?: string; categoryId?: string }) => api.post('/promo-codes/validate', { code, ...ctx }),
  redeem: (data: { code: string; saleId?: string; discountAppliedMinorUnits?: number }) => api.post('/promo-codes/redeem', data),
  deactivate: (id: string) => api.post(`/promo-codes/${id}/deactivate`),
  history: (id: string) => api.get(`/promo-codes/${id}/history`),
};

// Stock reconciliation — inventory variance ≥20% (decision 7)
export const stockReconciliationApi = {
  count: (data: { productId: string; physicalQty: number }) => api.post('/stock-reconciliation/count', data),
  pending: () => api.get('/stock-reconciliation/pending'),
  confirm: (id: string, data: { confirmedQty: number; reason: string }) => api.post(`/stock-reconciliation/${id}/confirm`, data),
  reject: (id: string, note?: string) => api.post(`/stock-reconciliation/${id}/reject`, { note }),
};

// ---------------------------------------------------------------------------
// Sales
// ---------------------------------------------------------------------------
export const salesApi = {
  list: (date?: string, storeId?: string) => api.get('/sales', { params: { date, storeId } }),
  get: (id: string) => api.get(`/sales/${id}`),
  void: (id: string, reason?: string) => api.post(`/sales/${id}/void`, reason ? { reason } : {}),
  // Payments to regularise (decision 6)
  pendingPayments: () => api.get('/sales/pending-payments'),
  regularizePayment: (id: string, data: { success: boolean; paymentId?: string; stripePaymentIntentId?: string }) =>
    api.post(`/sales/${id}/regularize-payment`, data),
};

// ---------------------------------------------------------------------------
// Returns / Credit notes (avoirs)
// ---------------------------------------------------------------------------
export const returnsApi = {
  list: (page = 1, limit = 50, saleId?: string) => api.get('/returns', { params: { page, limit, saleId } }),
  get: (id: string) => api.get(`/returns/${id}`),
  returnable: (saleId: string) => api.get(`/returns/sale/${saleId}/returnable`),
  create: (
    data: {
      originalSaleId: string;
      items: { lineItemId: string; quantity: number }[];
      reason?: string;
      refundMethod: 'cash' | 'card' | 'store_credit';
    },
    idempotencyKey: string,
  ) => api.post('/returns', data, { headers: { 'Idempotency-Key': idempotencyKey } }),
  issueGiftCard: (
    data: { amountMinorUnits: number; code?: string },
    idempotencyKey: string,
  ) => api.post('/returns/gift-card', data, { headers: { 'Idempotency-Key': idempotencyKey } }),
};

// Documents PDF (duplicata / justificatif avoir / Z) — rendus verbatim serveur.
export const documentsApi = {
  saleDuplicata: (saleId: string) =>
    api.get(`/documents/sales/${saleId}/duplicata`, { responseType: 'blob' }),
  creditNoteJustificatif: (creditNoteId: string) =>
    api.get(`/documents/credit-notes/${creditNoteId}/justificatif`, { responseType: 'blob' }),
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
  list: (storeId?: string) =>
    api.get('/employees', { params: storeId ? { storeId } : {} }),
  get: (id: string) => api.get(`/employees/${id}`),
  create: (data: any) => api.post('/employees', data),
  update: (id: string, data: any) => api.put(`/employees/${id}`, data),
  // Backend exposes POST (not PUT) for (de)activation.
  deactivate: (id: string) => api.post(`/employees/${id}/deactivate`),
  reactivate: (id: string) => api.post(`/employees/${id}/reactivate`),
  changePin: (id: string, pin: string) => api.patch(`/employees/${id}/pin`, { pin }),
  getQr: (id: string) => api.get(`/employees/${id}/qr`),
  roleDefaults: () => api.get('/employees/rights/defaults'),
};

// ---------------------------------------------------------------------------
// TimeWin24 Proxy (employee context, clock-in/out, events)
// ---------------------------------------------------------------------------
export const timewinApi = {
  health: () => api.get('/timewin/health'),
  login: (data: { pin?: string; qrCode?: string; storeId: string; deviceId?: string }) =>
    api.post('/timewin/login', data),
  getContext: (employeeId: string) => api.get(`/timewin/employees/${employeeId}/context`),
  syncEmployees: (storeId: string) => api.get('/timewin/employees/sync', { params: { storeId } }),
  todayShifts: (storeId: string) => api.get('/timewin/today-shifts', { params: { storeId } }),
  payroll: (storeId: string, month: string) =>
    api.get('/timewin/payroll', { params: { storeId, month } }),
  storeConfig: (storeId: string) => api.get('/timewin/store-config', { params: { storeId } }),
  getStoreSchedule: (storeId: string) => api.get('/timewin/store-schedule', { params: { storeId } }),
  updateStoreSchedule: (storeId: string, schedules: any[]) =>
    api.put('/timewin/store-schedule', { schedules }, { params: { storeId } }),
  stores: () => api.get('/timewin/stores'),
  clockIn: (employeeId: string, storeId: string) => api.post('/timewin/clock-in', { employeeId, storeId }),
  clockOut: (employeeId: string, storeId: string) => api.post('/timewin/clock-out', { employeeId, storeId }),
  pushEvent: (data: { storeId: string; eventType: string; employeeId?: string; data?: any }) =>
    api.post('/timewin/events', data),
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
  accessible: () => api.get('/stores/accessible'),
  networkSummary: () => api.get('/stores/network-summary'),
  syncFromTimeWin: () => api.post('/stores/sync'),
  getSchedule: (storeId: string) => api.get(`/stores/${storeId}/schedule`),
  updateSchedule: (storeId: string, schedules: any[]) => api.put(`/stores/${storeId}/schedule`, { schedules }),
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
  /** Period analytics over an inclusive date range (read-only, sales-derived). */
  periodSummary: (storeId: string, startDate: string, endDate: string) =>
    api.get('/reports/summary', { params: { storeId, startDate, endDate } }),
  storeKpi: (storeId: string, date: string) =>
    api.get('/reports/store-kpi', { params: { storeId, date } }),
  /** Top / flop / dormant + rupture & réassort (lecture seule, dérivé des ventes). */
  productAnalytics: (storeId: string) =>
    api.get('/reports/product-analytics', { params: { storeId } }),
  /** Comparaisons CA J-1/S-1/M-1/N-1 + prévision simple (lecture seule). */
  salesTrend: (storeId: string) =>
    api.get('/reports/sales-trend', { params: { storeId } }),
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

// IA / Intelligence → migrated to TimeWin24

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

// ── RH APIs removed — managed by TimeWin24 ──
// rightsApi, pointageApi, planningApi, payrollApi

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

// ---------------------------------------------------------------------------
// Stock Locations (multi-warehouse)
// ---------------------------------------------------------------------------
export const stockLocationsApi = {
  // Locations
  listLocations: () => api.get('/stock-locations/locations'),
  createLocation: (data: { name: string; code: string; type: string; storeId?: string; address?: string }) =>
    api.post('/stock-locations/locations', data),

  // Stock views
  networkStock: () => api.get('/stock-locations/network'),
  productBalances: (productId: string) => api.get(`/stock-locations/product/${productId}/balances`),
  locationBalances: (locationId: string) => api.get(`/stock-locations/location/${locationId}/balances`),

  // Operations
  receive: (data: { productId: string; locationId: string; quantity: number; reference?: string; reason?: string }) =>
    api.post('/stock-locations/receive', data),
  transfer: (data: { productId: string; fromLocationId: string; toLocationId: string; quantity: number; reference?: string }) =>
    api.post('/stock-locations/transfer', data),
  dispatch: (data: { productId: string; fromLocationId: string; dispatches: { toLocationId: string; quantity: number }[]; reference?: string }) =>
    api.post('/stock-locations/dispatch', data),

  // History
  productMovements: (productId: string, limit = 50) =>
    api.get(`/stock-locations/movements/product/${productId}?limit=${limit}`),
  locationMovements: (locationId: string, limit = 50) =>
    api.get(`/stock-locations/movements/location/${locationId}?limit=${limit}`),
};

// ---------------------------------------------------------------------------
// Airtable Ops Layer
// ---------------------------------------------------------------------------
export const airtableOpsApi = {
  // Operations
  listOperations: (params?: {
    storeId?: string;
    status?: string;
    riskLevel?: string;
    page?: number;
    limit?: number;
  }) => api.get('/airtable-ops/operations', { params }),
  getOperation: (id: string) => api.get(`/airtable-ops/operations/${id}`),
  approveOperation: (id: string) => api.post(`/airtable-ops/operations/${id}/approve`),
  rejectOperation: (id: string, reason: string) =>
    api.post(`/airtable-ops/operations/${id}/reject`, { reason }),
  applyOperation: (id: string) => api.post(`/airtable-ops/operations/${id}/apply`),

  // Sync
  triggerSync: (storeId?: string) => api.post('/airtable-ops/sync', { storeId }),

  // Stats & logs
  getStats: (storeId?: string) => api.get('/airtable-ops/stats', { params: { storeId } }),
  getLogs: (storeId?: string, limit?: number) =>
    api.get('/airtable-ops/logs', { params: { storeId, limit } }),
};

// ---------------------------------------------------------------------------
// Sales Guards (anti-error anomalies)
// ---------------------------------------------------------------------------
export const salesGuardsApi = {
  getConfig: () => api.get('/sales-guards/config'),
  evaluate: (data: {
    items: unknown[];
    saleId?: string;
    freeProductUsageCount?: number;
    cancellationCount?: number;
  }) => api.post('/sales-guards/evaluate', data),
  listAnomalies: (params?: {
    storeId?: string;
    sellerId?: string;
    code?: string;
    status?: string;
    severity?: string;
    from?: string;
    page?: number;
    limit?: number;
  }) => api.get('/sales-guards/anomalies', { params }),
  summary: (storeId?: string, from?: string) =>
    api.get('/sales-guards/anomalies/summary', { params: { storeId, from } }),
  approve: (id: string) => api.post(`/sales-guards/anomalies/${id}/approve`),
  ignore: (id: string) => api.post(`/sales-guards/anomalies/${id}/ignore`),
};

// ---------------------------------------------------------------------------
// POS sessions & écarts caisse (manager/admin, lecture) — source probante :
// chaque session porte employé + terminal + comptage (attendu/compté/écart
// dérivés serveur, jamais déclarés par le client).
// ---------------------------------------------------------------------------
export const posSessionsApi = {
  list: (params?: { limit?: number; activeOnly?: boolean; withCashCountOnly?: boolean; storeId?: string }) =>
    api.get('/pos-sessions', { params }),
};

// ---------------------------------------------------------------------------
// Score employé — alertes manager (faits importants récents) + score par employé.
// ---------------------------------------------------------------------------
export const employeeScoreApi = {
  alerts: (sinceHours?: number) => api.get('/employee-score/alerts', { params: { sinceHours } }),
  team: (sinceDays?: number) => api.get('/employee-score/team', { params: { sinceDays } }),
  employee: (employeeId: string, period: 'day' | 'week' | 'year' = 'day') =>
    api.get(`/employee-score/employee/${employeeId}`, { params: { period } }),
  employeeDetail: (employeeId: string) => api.get(`/employee-score/employee/${employeeId}/detail`),
};

// ---------------------------------------------------------------------------
// Attract campaigns (Bloc 4) — playlists de l'écran client. Manager gère son
// magasin ; national (storeId NULL) réservé admin. Le résolveur /playlist est
// consommé par la caisse, pas par le backoffice.
// ---------------------------------------------------------------------------
export interface AttractMediaPayload {
  type: 'video' | 'image';
  url: string;
  durationSeconds?: number;
}
export interface AttractCampaignPayload {
  name: string;
  scope?: 'store' | 'national';
  isActive?: boolean;
  loop?: boolean;
  startsAt?: string | null;
  endsAt?: string | null;
  priority?: number;
  terminalIds?: string[] | null;
  media?: AttractMediaPayload[];
}
export const attractApi = {
  list: () => api.get('/attract/campaigns'),
  get: (id: string) => api.get(`/attract/campaigns/${id}`),
  create: (data: AttractCampaignPayload) => api.post('/attract/campaigns', data),
  update: (id: string, data: Partial<AttractCampaignPayload>) =>
    api.put(`/attract/campaigns/${id}`, data),
  setMedia: (id: string, media: AttractMediaPayload[]) =>
    api.put(`/attract/campaigns/${id}/media`, { media }),
  remove: (id: string) => api.delete(`/attract/campaigns/${id}`),
};

// ── Enrôlement machine POS (Partie B) ──
export interface PosMachine {
  id: string;
  machineId: string;
  storeId: string;
  terminalLabel: string;
  machineName: string | null;
  platform: string | null;
  appVersion: string | null;
  status: 'pending' | 'approved' | 'rejected' | 'revoked';
  requestedBy: string | null;
  decidedBy: string | null;
  decidedAt: string | null;
  decisionReason: string | null;
  lastSeenAt: string | null;
  createdAt: string;
}
export const enrollmentApi = {
  list: (status?: string) => api.get('/pos/enrollment', { params: status ? { status } : {} }),
  approve: (id: string) => api.post(`/pos/enrollment/${id}/approve`, {}),
  reject: (id: string, reason: string) => api.post(`/pos/enrollment/${id}/reject`, { reason }),
  revoke: (id: string, reason: string) => api.post(`/pos/enrollment/${id}/revoke`, { reason }),
};

// ---------------------------------------------------------------------------
// Sécurité & accès (pilotage RBAC + audit des droits)
// ---------------------------------------------------------------------------
export const securityApi = {
  /** Périmètre magasin effectif du demandeur. */
  myScope: () => api.get('/pilotage/access/me'),
  grantApplicationAccess: (
    employeeId: string,
    body: { applicationRole: string; applicationEnabled?: boolean; validFrom?: string; validUntil?: string; reason?: string },
  ) => api.post(`/pilotage/admin/employees/${employeeId}/application-access`, body),
  suspend: (employeeId: string, reason?: string) =>
    api.post(`/pilotage/admin/employees/${employeeId}/suspend`, { reason }),
  reactivate: (employeeId: string) =>
    api.post(`/pilotage/admin/employees/${employeeId}/reactivate`, {}),
  grantStore: (
    employeeId: string,
    storeId: string,
    body: { accessRole?: string; canViewDashboard?: boolean; canViewFinancials?: boolean; canViewEmployees?: boolean; canViewAlerts?: boolean; canCompare?: boolean; validFrom?: string; validUntil?: string; reason?: string },
  ) => api.put(`/pilotage/admin/employees/${employeeId}/stores/${storeId}`, body),
  revokeStore: (employeeId: string, storeId: string, reason?: string) =>
    api.delete(`/pilotage/admin/employees/${employeeId}/stores/${storeId}`, { data: { reason } }),
  auditList: (params?: { scope?: string; limit?: number; offset?: number }) =>
    api.get('/pilotage/admin/access-audit', { params }),
  auditVerify: (scope?: string) =>
    api.get('/pilotage/admin/access-audit/verify', { params: scope ? { scope } : {} }),
};

// ---------------------------------------------------------------------------
// Journal d'activité (connexions / sessions / consultations)
// ---------------------------------------------------------------------------
export const activityApi = {
  loginEvents: (params?: { employeeId?: string; success?: boolean; method?: string; from?: string; to?: string; page?: number; limit?: number }) =>
    api.get('/activity/login-events', { params }),
  sessions: (params?: { employeeId?: string; activeOnly?: boolean }) =>
    api.get('/activity/sessions', { params }),
  viewEvents: (params?: { employeeId?: string; storeId?: string; module?: string; action?: string; from?: string; to?: string; page?: number; limit?: number }) =>
    api.get('/activity/view-events', { params }),
  stats: (employeeId: string) => api.get(`/activity/employees/${employeeId}/stats`),
  revokeSession: (sessionId: string, reason?: string) =>
    api.post(`/activity/sessions/${sessionId}/revoke`, { reason }),
  revokeAll: (employeeId: string, reason?: string) =>
    api.post(`/activity/employees/${employeeId}/revoke-sessions`, { reason }),
};

export default api;
