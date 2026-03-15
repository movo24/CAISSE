import { create } from 'zustand';
import { authApi } from '../services/api';

// ── JWT expiry helper ──
function isTokenExpired(token: string): boolean {
  try {
    const payload = JSON.parse(atob(token.split('.')[1]));
    // 30s buffer
    return payload.exp * 1000 < Date.now() + 30000;
  } catch {
    return true;
  }
}

interface AuthState {
  // State
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

  // Actions
  login: (storeId: string, pin: string) => Promise<void>;
  logout: () => void;
  restoreSession: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  isAuthenticated: false,
  employee: null,
  accessToken: null,
  isLoading: false,
  error: null,

  login: async (storeId: string, pin: string) => {
    set({ isLoading: true, error: null });
    try {
      const response = await authApi.loginPin(storeId, pin);
      const { accessToken, refreshToken, employee } = response.data;

      localStorage.setItem('accessToken', accessToken);
      localStorage.setItem('refreshToken', refreshToken);
      localStorage.setItem('employee', JSON.stringify(employee));

      set({
        isAuthenticated: true,
        employee,
        accessToken,
        isLoading: false,
      });
    } catch (err: any) {
      set({
        isLoading: false,
        error: err.response?.data?.message || 'Erreur de connexion',
      });
    }
  },

  logout: () => {
    // Call backend logout to revoke tokens (fire-and-forget)
    authApi.logout().catch(() => {});
    localStorage.removeItem('accessToken');
    localStorage.removeItem('refreshToken');
    localStorage.removeItem('employee');
    set({
      isAuthenticated: false,
      employee: null,
      accessToken: null,
    });
  },

  restoreSession: () => {
    const token = localStorage.getItem('accessToken');
    const refreshToken = localStorage.getItem('refreshToken');
    const empStr = localStorage.getItem('employee');

    if (!token || !empStr) return;

    // Validate token expiry
    if (isTokenExpired(token)) {
      // Access token expired — check if refresh token is still valid
      if (refreshToken && !isTokenExpired(refreshToken)) {
        // Refresh token is valid, try to refresh (handled by api interceptor)
        // For now, restore session with expired access token — the api interceptor
        // will refresh it on the first API call
        try {
          const employee = JSON.parse(empStr);
          set({ isAuthenticated: true, employee, accessToken: token });
        } catch {
          localStorage.removeItem('accessToken');
          localStorage.removeItem('refreshToken');
          localStorage.removeItem('employee');
        }
        return;
      }
      // Both tokens expired — clear session
      localStorage.removeItem('accessToken');
      localStorage.removeItem('refreshToken');
      localStorage.removeItem('employee');
      return;
    }

    try {
      const employee = JSON.parse(empStr);
      set({ isAuthenticated: true, employee, accessToken: token });
    } catch {
      // Corrupted data, clear
      localStorage.removeItem('accessToken');
      localStorage.removeItem('refreshToken');
      localStorage.removeItem('employee');
    }
  },
}));
