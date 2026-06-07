/**
 * offlineStore — état offline-first de l'app Inventaire (socle).
 *
 * Responsabilités :
 *  - statut réseau online/offline (visible dans l'UI) ;
 *  - compteur d'éléments en attente de sync ;
 *  - enfilement d'un comptage (avec audit employeeId/storeId/deviceId/timestamp) ;
 *  - sync différée déclenchée au retour réseau / manuellement.
 *
 * Le poster réel cible POST /api/inventory-scans via le client JWT.
 */
import { create } from 'zustand';
import { useAuthStore } from './authStore';
import { getDeviceId } from '../offline/deviceId';
import { subscribeNetwork, checkOnline, NetworkStatus } from '../offline/network';
import { enqueueCount, countOutstanding, CountPayload } from '../offline/queue';
import { drainQueue } from '../offline/syncEngine';
import { inventoryScanApi } from '../services/api';

const poster = (p: CountPayload & { clientEntryId: string }) =>
  inventoryScanApi.record({
    barcode: p.barcode,
    quantity: p.quantity,
    scanType: p.scanType,
    sessionId: p.sessionId,
    notes: p.notes,
    clientEntryId: p.clientEntryId, // idempotence serveur (dédup sur rejeu)
  });

interface OfflineState {
  status: NetworkStatus;
  outstanding: number;
  syncing: boolean;
  lastSyncAt: string | null;
  initialized: boolean;

  init: () => void;
  refresh: () => Promise<void>;
  enqueue: (payload: CountPayload) => Promise<void>;
  syncNow: () => Promise<void>;
}

let unsubscribe: (() => void) | null = null;

export const useOfflineStore = create<OfflineState>((set, get) => ({
  status: 'online',
  outstanding: 0,
  syncing: false,
  lastSyncAt: null,
  initialized: false,

  init: () => {
    if (get().initialized) return;
    set({ initialized: true });

    // Abonnement aux events réseau natifs.
    unsubscribe?.();
    unsubscribe = subscribeNetwork((status) => {
      set({ status });
      if (status === 'online') void get().syncNow();
    });

    // Statut initial fiable (ping) + premier refresh + sync.
    void checkOnline().then((ok) => {
      set({ status: ok ? 'online' : 'offline' });
      void get().refresh();
      if (ok) void get().syncNow();
    });
  },

  refresh: async () => {
    try {
      set({ outstanding: await countOutstanding() });
    } catch {
      /* lecture IndexedDB best-effort */
    }
  },

  enqueue: async (payload: CountPayload) => {
    const auth = useAuthStore.getState();
    const employeeId = auth.employee?.id ?? 'unknown';
    const storeId = auth.employee?.storeId ?? auth.storeInfo?.id ?? 'unknown';
    await enqueueCount({ employeeId, storeId, deviceId: getDeviceId(), payload });
    await get().refresh();
    if (get().status === 'online') void get().syncNow();
  },

  syncNow: async () => {
    if (get().syncing) return;
    set({ syncing: true });
    try {
      await drainQueue(poster);
      await get().refresh();
      set({ lastSyncAt: new Date().toISOString() });
    } finally {
      set({ syncing: false });
    }
  },
}));
