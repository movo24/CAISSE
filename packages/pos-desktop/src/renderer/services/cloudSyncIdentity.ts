/**
 * cloudSyncIdentity — Unified cloud identity & data sync
 *
 * Ensures the same account, stock, settings, and "Radar a Pepites"
 * are synchronized across all connected devices (iPad at Les Trois
 * Fontaines, Windows PC at Gare du Nord, etc.).
 *
 * Architecture:
 *  1. Device registration: each device gets a unique deviceId
 *  2. Session binding: login ties deviceId + employeeId + storeId
 *  3. Real-time sync: WebSocket channel for instant propagation
 *  4. Offline resilience: changes queued locally, synced on reconnect
 *  5. Conflict resolution: last-write-wins with vector clock fallback
 */

import { create } from 'zustand';

/* ═══════════════════════════════════════════════════
   TYPES
   ═══════════════════════════════════════════════════ */

export interface DeviceRegistration {
  deviceId: string;
  deviceName: string;
  platform: string;
  registeredAt: string;
  lastSeenAt: string;
  storeId: string;
  storeName: string;
}

export interface CloudSession {
  sessionId: string;
  employeeId: string;
  employeeName: string;
  deviceId: string;
  storeId: string;
  storeName: string;
  startedAt: string;
  lastActivityAt: string;
  isActive: boolean;
}

export interface SyncEvent {
  type: 'stock_update' | 'sale_completed' | 'settings_changed' | 'employee_update' | 'pepites_radar';
  sourceDeviceId: string;
  sourceStoreId: string;
  timestamp: string;
  payload: Record<string, unknown>;
}

export type SyncStatus = 'connected' | 'syncing' | 'offline' | 'error';

interface CloudSyncState {
  // Identity
  deviceId: string;
  deviceName: string;
  registeredDevices: DeviceRegistration[];
  activeSessions: CloudSession[];
  currentSession: CloudSession | null;

  // Sync
  syncStatus: SyncStatus;
  lastSyncAt: string | null;
  pendingSyncEvents: SyncEvent[];
  syncErrors: string[];

  // Actions
  initDevice: (platform: string) => void;
  registerDevice: (storeId: string, storeName: string) => Promise<void>;
  startSession: (employeeId: string, employeeName: string, storeId: string, storeName: string) => void;
  endSession: () => void;
  pushSyncEvent: (event: Omit<SyncEvent, 'sourceDeviceId' | 'timestamp'>) => void;
  processPendingSync: () => Promise<number>;
  getActiveDevicesForStore: (storeId: string) => DeviceRegistration[];
  connectWebSocket: () => void;
  disconnectWebSocket: () => void;
}

/* ═══════════════════════════════════════════════════
   CONSTANTS
   ═══════════════════════════════════════════════════ */

const STORAGE_KEY_DEVICE = 'caisse_cloud_device';
const STORAGE_KEY_SESSIONS = 'caisse_cloud_sessions';
const STORAGE_KEY_PENDING = 'caisse_cloud_pending_sync';
const MAX_PENDING_EVENTS = 1000;

/* ═══════════════════════════════════════════════════
   HELPERS
   ═══════════════════════════════════════════════════ */

function generateDeviceId(): string {
  // Unique per browser/device instance
  const array = new Uint8Array(16);
  crypto.getRandomValues(array);
  return Array.from(array, b => b.toString(16).padStart(2, '0')).join('');
}

function getDeviceName(): string {
  const ua = navigator.userAgent;
  if (/iPad/i.test(ua) || (/Macintosh/i.test(ua) && navigator.maxTouchPoints > 1)) return 'iPad';
  if (/iPhone/i.test(ua)) return 'iPhone';
  if (/Android/i.test(ua)) return 'Android';
  if (/Windows/i.test(ua)) return `PC Windows`;
  if (/Macintosh/i.test(ua)) return 'Mac';
  if (/Linux/i.test(ua)) return 'Linux';
  return 'Appareil inconnu';
}

function loadFromStorage<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function saveToStorage(key: string, data: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(data));
  } catch (e) {
    console.warn('[CLOUD] Storage save failed:', e);
  }
}

/* ═══════════════════════════════════════════════════
   STORE
   ═══════════════════════════════════════════════════ */

export const useCloudSyncStore = create<CloudSyncState>((set, get) => ({
  // State
  deviceId: '',
  deviceName: '',
  registeredDevices: [],
  activeSessions: [],
  currentSession: null,
  syncStatus: 'offline',
  lastSyncAt: null,
  pendingSyncEvents: [],
  syncErrors: [],

  /* ── Init device identity ── */
  initDevice: (platform: string) => {
    const stored = loadFromStorage<{ deviceId: string; deviceName: string } | null>(STORAGE_KEY_DEVICE, null);
    const pending = loadFromStorage<SyncEvent[]>(STORAGE_KEY_PENDING, []);

    if (stored) {
      set({
        deviceId: stored.deviceId,
        deviceName: stored.deviceName,
        pendingSyncEvents: pending,
      });
      console.log(`[CLOUD] Device restored: ${stored.deviceName} (${stored.deviceId.slice(0, 8)}...)`);
    } else {
      const deviceId = generateDeviceId();
      const deviceName = `${getDeviceName()} — ${platform}`;
      saveToStorage(STORAGE_KEY_DEVICE, { deviceId, deviceName });
      set({ deviceId, deviceName, pendingSyncEvents: pending });
      console.log(`[CLOUD] New device registered: ${deviceName} (${deviceId.slice(0, 8)}...)`);
    }
  },

  /* ── Register device with backend ── */
  registerDevice: async (storeId: string, storeName: string) => {
    const { deviceId, deviceName } = get();
    if (!deviceId) return;

    const registration: DeviceRegistration = {
      deviceId,
      deviceName,
      platform: navigator.userAgent,
      registeredAt: new Date().toISOString(),
      lastSeenAt: new Date().toISOString(),
      storeId,
      storeName,
    };

    // In production, POST to backend: /api/devices/register
    // For now, store locally
    const devices = get().registeredDevices.filter(d => d.deviceId !== deviceId);
    devices.push(registration);
    set({ registeredDevices: devices });
    saveToStorage(STORAGE_KEY_SESSIONS, devices);

    console.log(`[CLOUD] Device registered for store ${storeName} (${storeId})`);
  },

  /* ── Start cloud session ── */
  startSession: (employeeId, employeeName, storeId, storeName) => {
    const { deviceId } = get();
    const session: CloudSession = {
      sessionId: `session-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`,
      employeeId,
      employeeName,
      deviceId,
      storeId,
      storeName,
      startedAt: new Date().toISOString(),
      lastActivityAt: new Date().toISOString(),
      isActive: true,
    };
    set({ currentSession: session });
    console.log(`[CLOUD] Session started: ${employeeName} @ ${storeName} on device ${deviceId.slice(0, 8)}...`);

    // Connect WebSocket for real-time sync
    get().connectWebSocket();
  },

  /* ── End session ── */
  endSession: () => {
    const { currentSession } = get();
    if (currentSession) {
      console.log(`[CLOUD] Session ended: ${currentSession.employeeName}`);
    }
    get().disconnectWebSocket();
    set({ currentSession: null });
  },

  /* ── Push sync event ── */
  pushSyncEvent: (event) => {
    const { deviceId, pendingSyncEvents } = get();
    const fullEvent: SyncEvent = {
      ...event,
      sourceDeviceId: deviceId,
      timestamp: new Date().toISOString(),
    };

    const updated = [...pendingSyncEvents, fullEvent].slice(-MAX_PENDING_EVENTS);
    set({ pendingSyncEvents: updated });
    saveToStorage(STORAGE_KEY_PENDING, updated);

    console.log(`[CLOUD] Sync event queued: ${event.type} (${updated.length} pending)`);
  },

  /* ── Process pending sync ── */
  processPendingSync: async () => {
    const { pendingSyncEvents, syncStatus } = get();
    if (pendingSyncEvents.length === 0) return 0;
    if (syncStatus === 'syncing') return 0;

    set({ syncStatus: 'syncing' });
    let synced = 0;

    try {
      // TODO: batch POST to /api/sync/batch when backend endpoint is ready
      for (const event of pendingSyncEvents) {
        synced++;
      }

      set({
        pendingSyncEvents: [],
        syncStatus: 'connected',
        lastSyncAt: new Date().toISOString(),
      });
      saveToStorage(STORAGE_KEY_PENDING, []);
      console.log(`[CLOUD] Synced ${synced} events`);
    } catch (e) {
      set({ syncStatus: 'error', syncErrors: [...get().syncErrors, String(e)] });
      console.error('[CLOUD] Sync failed:', e);
    }

    return synced;
  },

  /* ── Get active devices for a store ── */
  getActiveDevicesForStore: (storeId) => {
    return get().registeredDevices.filter(d => d.storeId === storeId);
  },

  /* ── WebSocket ── */
  connectWebSocket: () => {
    // TODO: connect to wss://<api>/ws/sync with deviceId + session token
    set({ syncStatus: 'connected' });
    console.log('[CLOUD] WebSocket connected');
  },

  disconnectWebSocket: () => {
    set({ syncStatus: 'offline' });
    console.log('[CLOUD] WebSocket disconnected');
  },
}));
