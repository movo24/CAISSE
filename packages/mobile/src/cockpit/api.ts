/**
 * Cockpit — typed client over the host app's authenticated axios instance (the
 * ONLY host dependency besides design primitives — the clean-boundary condition:
 * extracting this module to @caisse/cockpit later is a folder move).
 * Reads = the six GET endpoints (server-scoped, INV-5); writes = the account
 * notification surface (separate from the GET-only cockpit router).
 */
import api from '../services/api';

export interface CockpitStore {
  storeId: string;
  name: string;
  organizationId: string | null;
  unitId: string | null;
  isActive: boolean;
  computedAt: string;
}

export interface CockpitOverview {
  scope: { storeCount: number };
  sales: {
    caNetMinor: number;
    caBrutMinor: number;
    txCount: number;
    voidCount: number;
    returnsAmountMinor: number;
    targetMinor: number | null;
    targetReachedPct: number | null;
  };
  sessions: { openSessions: number; activeTerminals: number };
  presence: { presentCount: number; expectedCount: number };
  stock: { ruptureCount: number; lowStockCount: number };
  computedAt: string | null;
}

export interface CockpitStoreLive {
  storeId: string;
  name: string | null;
  sessions: { openSessions: number; activeTerminals: number };
  presence: { presentCount: number; expectedCount: number };
  stock: { ruptureCount: number; lowStockCount: number };
  computedAt: string | null;
}

export interface CockpitStorePerformance {
  storeId: string;
  businessDay: string;
  caBrutMinor: number;
  netMinor: number;
  txCount: number;
  voidCount: number;
  returnsAmountMinor: number;
  avgBasketMinor: number;
  computedAt: string | null;
}

export interface CockpitAlert {
  id: string;
  storeId: string;
  rule: string;
  thresholdBand: string;
  businessDay: string;
  payload: Record<string, unknown> | null;
  computedAt: string;
  createdAt: string;
}

export interface CockpitBrief {
  businessDay: string;
  beat: number | null;
  text: string | null;
  status: string;
  computedAt: string | null;
}

export interface NotifyPreferences {
  employeeId?: string;
  enabled: boolean;
  quietStartHour: number | null;
  quietEndHour: number | null;
}

export const cockpitApi = {
  stores: (): Promise<CockpitStore[]> => api.get('/mobile/v1/stores').then((r) => r.data),
  overview: (): Promise<CockpitOverview> => api.get('/mobile/v1/dashboard/overview').then((r) => r.data),
  storeLive: (id: string): Promise<CockpitStoreLive> => api.get(`/mobile/v1/stores/${id}/live`).then((r) => r.data),
  storePerformance: (id: string): Promise<CockpitStorePerformance> =>
    api.get(`/mobile/v1/stores/${id}/performance`).then((r) => r.data),
  alerts: (): Promise<CockpitAlert[]> => api.get('/mobile/v1/alerts').then((r) => r.data),
  brief: (): Promise<CockpitBrief> => api.get('/mobile/v1/ai-brief').then((r) => r.data),

  // account surface (writes live OFF the GET-only cockpit router)
  getPreferences: (): Promise<NotifyPreferences> =>
    api.get('/mobile/v1/notifications/preferences').then((r) => r.data),
  setPreferences: (prefs: NotifyPreferences): Promise<NotifyPreferences> =>
    api.put('/mobile/v1/notifications/preferences', prefs).then((r) => r.data),
  registerDevice: (token: string, platform: string): Promise<{ id: string; status: string }> =>
    api.post('/mobile/v1/notifications/devices', { token, platform }).then((r) => r.data),
  unregisterDevice: (token: string): Promise<{ status: string }> =>
    api.delete(`/mobile/v1/notifications/devices/${encodeURIComponent(token)}`).then((r) => r.data),
};
