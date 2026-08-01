import { create } from 'zustand';
import { authApi, storesApi } from '../services/api';
import { classifyAuthError, type AuthErrorKind } from '../utils/authError';

// ── JWT expiry helper ──
function isTokenExpired(token: string): boolean {
  try {
    const payload = JSON.parse(atob(token.split('.')[1]));
    return payload.exp * 1000 < Date.now() + 30000;
  } catch {
    return true;
  }
}

export type AppType = 'pos' | 'timewin24';

export interface StoreInfo {
  id: string;
  name: string;
  storeCode?: string;
  city?: string;
  isActive: boolean;
}

interface AuthState {
  // Auth (decoupled from store context)
  isAuthenticated: boolean;
  employee: {
    id: string;
    firstName: string;
    lastName: string;
    role: string;
    storeId: string;
  } | null;
  accessToken: string | null;
  isLoading: boolean;
  error: string | null;
  /** Nature de l'échec : distingue identifiants refusés / serveur HS / réseau absent. */
  errorKind: AuthErrorKind | null;
  /** Ligne technique (URL réellement appelée + code HTTP) pour le diagnostic. */
  errorDetail: string | null;

  // Multi-store context (independent of auth)
  currentStoreId: string | null;
  stores: StoreInfo[];

  // Multi-app context
  currentApp: AppType;

  // Actions
  login: (storeId: string, pin: string) => Promise<void>;
  loginAdmin: (email: string, pin: string) => Promise<void>;
  logout: () => void;
  restoreSession: () => void;
  loadStores: () => Promise<void>;
  setCurrentStore: (storeId: string | null) => void;
  setCurrentApp: (app: AppType) => void;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  isAuthenticated: false,
  employee: null,
  accessToken: null,
  isLoading: false,
  error: null,
  errorKind: null,
  errorDetail: null,
  currentStoreId: null,
  stores: [],
  currentApp: (localStorage.getItem('currentApp') as AppType) || 'pos',

  login: async (storeId: string, pin: string) => {
    set({ isLoading: true, error: null, errorKind: null, errorDetail: null });
    try {
      const response = await authApi.loginPin(storeId, pin);
      const { accessToken, refreshToken, employee } = response.data;

      localStorage.setItem('accessToken', accessToken);
      localStorage.setItem('refreshToken', refreshToken);
      localStorage.setItem('employee', JSON.stringify(employee));
      localStorage.setItem('currentStoreId', employee.storeId);

      set({
        isAuthenticated: true,
        employee,
        accessToken,
        currentStoreId: employee.storeId,
        isLoading: false,
      });

      // Admin: load accessible stores in background
      if (employee.role === 'admin') {
        get().loadStores();
      }
    } catch (err: any) {
      const classified = classifyAuthError(err);
      console.error('[Auth] Échec login magasin:', classified.kind, classified.detail);
      set({
        isLoading: false,
        error: classified.message,
        errorKind: classified.kind,
        errorDetail: classified.detail,
      });
    }
  },

  loginAdmin: async (email: string, pin: string) => {
    set({ isLoading: true, error: null, errorKind: null, errorDetail: null });
    try {
      const response = await authApi.loginAdmin(email, pin);
      const { accessToken, refreshToken, employee } = response.data;

      localStorage.setItem('accessToken', accessToken);
      localStorage.setItem('refreshToken', refreshToken);
      localStorage.setItem('employee', JSON.stringify(employee));
      localStorage.removeItem('currentStoreId');

      set({
        isAuthenticated: true,
        employee,
        accessToken,
        currentStoreId: null,
        isLoading: false,
      });

      get().loadStores();
    } catch (err: any) {
      const classified = classifyAuthError(err);
      console.error('[Auth] Échec login admin:', classified.kind, classified.detail);
      set({
        isLoading: false,
        error: classified.message,
        errorKind: classified.kind,
        errorDetail: classified.detail,
      });
    }
  },

  logout: () => {
    authApi.logout().catch(() => console.warn('[Auth] Server-side logout failed'));
    localStorage.removeItem('accessToken');
    localStorage.removeItem('refreshToken');
    localStorage.removeItem('employee');
    localStorage.removeItem('currentStoreId');
    localStorage.removeItem('currentApp');
    set({
      isAuthenticated: false,
      employee: null,
      accessToken: null,
      currentStoreId: null,
      stores: [],
      currentApp: 'pos',
      error: null,
      errorKind: null,
      errorDetail: null,
    });
  },

  restoreSession: () => {
    const token = localStorage.getItem('accessToken');
    const refreshToken = localStorage.getItem('refreshToken');
    const empStr = localStorage.getItem('employee');
    const savedStoreId = localStorage.getItem('currentStoreId');
    const savedApp = (localStorage.getItem('currentApp') as AppType) || 'pos';

    if (!token || !empStr) return;

    if (isTokenExpired(token)) {
      if (refreshToken && !isTokenExpired(refreshToken)) {
        // Access token expired but refresh is valid — restore session,
        // API interceptor will refresh on first call
        try {
          const employee = JSON.parse(empStr);
          const cachedStores = (() => { try { return JSON.parse(localStorage.getItem('stores') || '[]'); } catch { return []; } })();
          set({
            isAuthenticated: true,
            employee,
            accessToken: token,
            currentStoreId: savedStoreId || employee.storeId,
            currentApp: savedApp,
            stores: cachedStores,
          });
          if (employee.role === 'admin') get().loadStores();
        } catch {
          localStorage.removeItem('accessToken');
          localStorage.removeItem('refreshToken');
          localStorage.removeItem('employee');
          set({ isAuthenticated: false, employee: null, accessToken: null });
        }
        return;
      }
      // Both tokens expired — force logout state
      localStorage.removeItem('accessToken');
      localStorage.removeItem('refreshToken');
      localStorage.removeItem('employee');
      set({ isAuthenticated: false, employee: null, accessToken: null, currentStoreId: null });
      return;
    }

    try {
      const employee = JSON.parse(empStr);
      const cachedStores = (() => { try { return JSON.parse(localStorage.getItem('stores') || '[]'); } catch { return []; } })();
      set({
        isAuthenticated: true,
        employee,
        accessToken: token,
        currentStoreId: savedStoreId || employee.storeId,
        currentApp: savedApp,
        stores: cachedStores,
      });
      if (employee.role === 'admin') get().loadStores();
    } catch {
      localStorage.removeItem('accessToken');
      localStorage.removeItem('refreshToken');
      localStorage.removeItem('employee');
      set({ isAuthenticated: false, employee: null, accessToken: null });
    }
  },

  loadStores: async () => {
    try {
      const res = await storesApi.accessible();
      const stores: StoreInfo[] = (res.data || []).map((s: any) => ({
        id: s.id,
        name: s.name,
        storeCode: s.storeCode,
        city: s.city,
        isActive: s.isActive !== false,
      }));
      set({ stores });
      localStorage.setItem('stores', JSON.stringify(stores));
    } catch {
      // Fallback: restore from localStorage cache
      try {
        const cached = localStorage.getItem('stores');
        if (cached) set({ stores: JSON.parse(cached) });
      } catch { /* ignore */ }
    }
  },

  setCurrentStore: (storeId: string | null) => {
    if (storeId) {
      localStorage.setItem('currentStoreId', storeId);
    } else {
      localStorage.removeItem('currentStoreId');
    }
    set({ currentStoreId: storeId });
  },

  setCurrentApp: (app: AppType) => {
    localStorage.setItem('currentApp', app);
    set({ currentApp: app });
  },
}));
