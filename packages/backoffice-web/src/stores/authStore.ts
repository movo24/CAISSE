import { create } from 'zustand';
import { authApi, storesApi } from '../services/api';

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

  // Multi-store context (independent of auth)
  currentStoreId: string | null;
  stores: StoreInfo[];

  // Multi-app context
  currentApp: AppType;

  // Actions
  login: (storeId: string, pin: string) => Promise<void>;
  logout: () => void;
  restoreSession: () => void;
  loadStores: () => Promise<void>;
  setCurrentStore: (storeId: string) => void;
  setCurrentApp: (app: AppType) => void;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  isAuthenticated: false,
  employee: null,
  accessToken: null,
  isLoading: false,
  error: null,
  currentStoreId: null,
  stores: [],
  currentApp: (localStorage.getItem('currentApp') as AppType) || 'pos',

  login: async (storeId: string, pin: string) => {
    set({ isLoading: true, error: null });
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
      set({
        isLoading: false,
        error: err.response?.data?.message || 'Erreur de connexion',
      });
    }
  },

  logout: () => {
    authApi.logout().catch(() => {});
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
        try {
          const employee = JSON.parse(empStr);
          set({
            isAuthenticated: true,
            employee,
            accessToken: token,
            currentStoreId: savedStoreId || employee.storeId,
            currentApp: savedApp,
          });
          if (employee.role === 'admin') get().loadStores();
        } catch {
          localStorage.removeItem('accessToken');
          localStorage.removeItem('refreshToken');
          localStorage.removeItem('employee');
        }
        return;
      }
      localStorage.removeItem('accessToken');
      localStorage.removeItem('refreshToken');
      localStorage.removeItem('employee');
      return;
    }

    try {
      const employee = JSON.parse(empStr);
      set({
        isAuthenticated: true,
        employee,
        accessToken: token,
        currentStoreId: savedStoreId || employee.storeId,
        currentApp: savedApp,
      });
      if (employee.role === 'admin') get().loadStores();
    } catch {
      localStorage.removeItem('accessToken');
      localStorage.removeItem('refreshToken');
      localStorage.removeItem('employee');
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
        isActive: s.isActive,
      }));
      set({ stores });
    } catch {
      // Silently fail — stores list is non-critical
    }
  },

  setCurrentStore: (storeId: string) => {
    localStorage.setItem('currentStoreId', storeId);
    set({ currentStoreId: storeId });
  },

  setCurrentApp: (app: AppType) => {
    localStorage.setItem('currentApp', app);
    set({ currentApp: app });
  },
}));
