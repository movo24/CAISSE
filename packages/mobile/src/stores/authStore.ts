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
  loginWesley: (email: string, pin: string) => Promise<void>;
  /** Applique une session déjà validée par le serveur (login passkey). */
  applySession: (session: any) => void;
  logout: () => void;
  restoreSession: () => void;

  // Role helper (lecture seule) : manager/admin = accès pilotage
  isSupervisor: () => boolean;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  isAuthenticated: false,
  employee: null,
  storeInfo: null,
  accessToken: null,
  isLoading: false,
  error: null,

  /**
   * Connexion via l'authentification CENTRALE du dashboard The Wesley
   * (email + code d'accès). Profil, rôle et périmètre magasins sont
   * renvoyés par le serveur — aucun code magasin saisi côté client.
   */
  loginWesley: async (email: string, pin: string) => {
    set({ isLoading: true, error: null });
    try {
      const response = await authApi.loginEmail(email, pin);
      const { accessToken, refreshToken, employee, storeInfo } = response.data;

      localStorage.setItem('accessToken', accessToken);
      localStorage.setItem('refreshToken', refreshToken);
      localStorage.setItem('employee', JSON.stringify(employee));
      if (storeInfo) localStorage.setItem('storeInfo', JSON.stringify(storeInfo));

      set({
        isAuthenticated: true,
        employee,
        storeInfo: storeInfo
          ? {
              id: storeInfo.id ?? employee.storeId,
              name: storeInfo.storeName || storeInfo.name || '',
              address: storeInfo.address,
            }
          : null,
        accessToken,
        isLoading: false,
      });
    } catch (err: any) {
      set({
        isLoading: false,
        error:
          err.response?.data?.message ||
          'Identifiants incorrects ou serveur indisponible.',
      });
    }
  },

  applySession: (session: any) => {
    const { accessToken, refreshToken, employee, storeInfo } = session;
    localStorage.setItem('accessToken', accessToken);
    localStorage.setItem('refreshToken', refreshToken);
    localStorage.setItem('employee', JSON.stringify(employee));
    if (storeInfo) localStorage.setItem('storeInfo', JSON.stringify(storeInfo));
    set({
      isAuthenticated: true,
      employee,
      storeInfo: storeInfo
        ? { id: storeInfo.id ?? employee.storeId, name: storeInfo.storeName || storeInfo.name || '', address: storeInfo.address }
        : null,
      accessToken,
      isLoading: false,
      error: null,
    });
  },

  logout: () => {
    authApi.logout().catch(() => console.warn('[Auth] Server-side logout failed'));
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

  // ── Role helper ── l'app de pilotage est réservée manager/admin

  isSupervisor: () => {
    const role = get().employee?.role;
    return role === 'manager' || role === 'admin';
  },
}));
