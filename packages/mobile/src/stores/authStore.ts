// ── Auth Store ───────────────────────────────────────────────────
// Zustand store for authentication + role-based permissions
// ─────────────────────────────────────────────────────────────────

import { create } from 'zustand';
import { authApi } from '../services/api';

function isTokenExpired(token: string): boolean {
  try {
    const payload = JSON.parse(atob(token.split('.')[1]));
    return payload.exp * 1000 < Date.now() + 30000;
  } catch {
    return true;
  }
}

export interface Employee {
  id: string;
  firstName: string;
  lastName: string;
  role: string;
  storeId: string;
}

export interface StoreInfo {
  id: string;
  name: string;
  address?: string;
}

interface AuthState {
  isAuthenticated: boolean;
  employee: Employee | null;
  storeInfo: StoreInfo | null;
  accessToken: string | null;
  isLoading: boolean;
  error: string | null;

  // Actions
  login: (storeId: string, pin: string) => Promise<void>;
  logout: () => void;
  restoreSession: () => void;

  // Role helpers
  canScan: () => boolean;
  canModifyStock: () => boolean;
  canValidate: () => boolean;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  isAuthenticated: false,
  employee: null,
  storeInfo: null,
  accessToken: null,
  isLoading: false,
  error: null,

  login: async (storeId: string, pin: string) => {
    set({ isLoading: true, error: null });
    try {
      const response = await authApi.loginPin(storeId, pin);
      const { accessToken, refreshToken, employee, storeInfo } = response.data;

      localStorage.setItem('accessToken', accessToken);
      localStorage.setItem('refreshToken', refreshToken);
      localStorage.setItem('employee', JSON.stringify(employee));
      if (storeInfo) localStorage.setItem('storeInfo', JSON.stringify(storeInfo));
      localStorage.setItem('lastStoreId', storeId);

      set({
        isAuthenticated: true,
        employee,
        storeInfo: storeInfo
          ? { id: storeId, name: storeInfo.storeName || storeInfo.name || storeId, address: storeInfo.address }
          : { id: storeId, name: storeId },
        accessToken,
        isLoading: false,
      });
    } catch (err: any) {
      set({
        isLoading: false,
        error: err.response?.data?.message || 'PIN incorrect ou erreur serveur',
      });
    }
  },

  logout: () => {
    authApi.logout().catch(() => {});
    localStorage.removeItem('accessToken');
    localStorage.removeItem('refreshToken');
    localStorage.removeItem('employee');
    localStorage.removeItem('storeInfo');
    set({
      isAuthenticated: false,
      employee: null,
      storeInfo: null,
      accessToken: null,
      isLoading: false,
      error: null,
    });
  },

  restoreSession: () => {
    const token = localStorage.getItem('accessToken');
    const refreshToken = localStorage.getItem('refreshToken');
    const empStr = localStorage.getItem('employee');
    const storeStr = localStorage.getItem('storeInfo');

    if (!token || !empStr) return;

    if (isTokenExpired(token)) {
      if (refreshToken && !isTokenExpired(refreshToken)) {
        try {
          const employee = JSON.parse(empStr);
          const storeInfo = storeStr ? JSON.parse(storeStr) : null;
          // Mark as authenticated — the API interceptor will refresh the token on first request
          // Store accessToken as null so it's not used stale; interceptor reads from localStorage
          set({ isAuthenticated: true, employee, storeInfo, accessToken: null });
        } catch {
          localStorage.removeItem('accessToken');
          localStorage.removeItem('refreshToken');
          localStorage.removeItem('employee');
          localStorage.removeItem('storeInfo');
        }
        return;
      }
      localStorage.removeItem('accessToken');
      localStorage.removeItem('refreshToken');
      localStorage.removeItem('employee');
      localStorage.removeItem('storeInfo');
      return;
    }

    try {
      const employee = JSON.parse(empStr);
      const storeInfo = storeStr ? JSON.parse(storeStr) : null;
      set({ isAuthenticated: true, employee, storeInfo, accessToken: token });
    } catch {
      localStorage.removeItem('accessToken');
      localStorage.removeItem('refreshToken');
      localStorage.removeItem('employee');
      localStorage.removeItem('storeInfo');
    }
  },

  // ── Role helpers ──
  // cashier → viewer (scan/search only)
  // manager → inventory (scan + inventory + receiving + stock adjust)
  // admin → manager (all + validate)

  canScan: () => {
    const role = get().employee?.role;
    return !!role; // All authenticated roles can scan
  },

  canModifyStock: () => {
    const role = get().employee?.role;
    return role === 'manager' || role === 'admin';
  },

  canValidate: () => {
    const role = get().employee?.role;
    return role === 'admin';
  },
}));
