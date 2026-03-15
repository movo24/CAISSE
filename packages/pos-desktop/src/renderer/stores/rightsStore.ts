import { create } from 'zustand';

/* ── Types ── */

export interface EmployeeRights {
  employeeId: string;
  role: 'admin' | 'manager' | 'cashier';
  maxDiscountPercent: number;
  canVoidSale: boolean;
  canRefund: boolean;
  canAccessReports: boolean;
  canManageStock: boolean;
  canDeleteTicket: boolean;
  canApplyManualDiscount: boolean;
  canOpenDrawer: boolean;
  canReprintTicket: boolean;
  isOverride: boolean;
  updatedAt: string;
}

const LS_KEY = 'caisse_employee_rights';

/* ── Role defaults (fallback when API is unreachable) ── */

const ROLE_DEFAULTS: Record<string, Omit<EmployeeRights, 'employeeId' | 'isOverride' | 'updatedAt'>> = {
  admin: {
    role: 'admin',
    maxDiscountPercent: 100,
    canVoidSale: true,
    canRefund: true,
    canAccessReports: true,
    canManageStock: true,
    canDeleteTicket: true,
    canApplyManualDiscount: true,
    canOpenDrawer: true,
    canReprintTicket: true,
  },
  manager: {
    role: 'manager',
    maxDiscountPercent: 20,
    canVoidSale: true,
    canRefund: true,
    canAccessReports: true,
    canManageStock: true,
    canDeleteTicket: false,
    canApplyManualDiscount: true,
    canOpenDrawer: true,
    canReprintTicket: true,
  },
  cashier: {
    role: 'cashier',
    maxDiscountPercent: 5,
    canVoidSale: false,
    canRefund: false,
    canAccessReports: false,
    canManageStock: false,
    canDeleteTicket: false,
    canApplyManualDiscount: false,
    canOpenDrawer: false,
    canReprintTicket: true,
  },
};

/* ── Store ── */

interface RightsState {
  rights: EmployeeRights | null;
  roleDefaults: typeof ROLE_DEFAULTS;

  setRights: (rights: EmployeeRights) => void;
  setRightsForRole: (employeeId: string, role: string) => void;
  loadFromCache: () => EmployeeRights | null;
  clearRights: () => void;
}

export const useRightsStore = create<RightsState>((set, get) => ({
  rights: null,
  roleDefaults: ROLE_DEFAULTS,

  setRights: (rights) => {
    set({ rights });
    try { localStorage.setItem(LS_KEY, JSON.stringify(rights)); } catch { /* quota */ }
  },

  /** Shortcut: build rights from role defaults (fallback) */
  setRightsForRole: (employeeId, role) => {
    const defaults = ROLE_DEFAULTS[role] || ROLE_DEFAULTS.cashier;
    const rights: EmployeeRights = {
      ...defaults,
      employeeId,
      isOverride: false,
      updatedAt: new Date().toISOString(),
    };
    get().setRights(rights);
  },

  loadFromCache: () => {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (!raw) return null;
      const rights = JSON.parse(raw) as EmployeeRights;
      set({ rights });
      return rights;
    } catch {
      return null;
    }
  },

  clearRights: () => {
    set({ rights: null });
    try { localStorage.removeItem(LS_KEY); } catch { /* ignore */ }
  },
}));

export { ROLE_DEFAULTS };
