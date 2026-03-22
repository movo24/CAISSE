import { create } from 'zustand';

/* ═══════════════════════════════════════════════════════════════
   OFFLINE STORE — File d'attente locale persistante
   Mode OFFLINE-FIRST pour encaissement continu sans Internet
   ═══════════════════════════════════════════════════════════════ */

// ── Types ──

export type OfflineEntryType = 'ticket' | 'payment' | 'stock_movement' | 'return' | 'void' | 'antifraude_log' | 'pointage' | 'cashier_metrics' | 'staffing_snapshot';

export type SyncStatus = 'local_pending' | 'syncing' | 'synced' | 'conflict' | 'failed';

export type PaymentAvailability = {
  cash: boolean;
  card: boolean;     // Dépend du TPE (autonome 4G ou via Internet caisse)
  qr: boolean;       // Souvent impossible offline
  wallet: boolean;   // Souvent impossible offline
};

export type NetworkStatus = 'online' | 'offline' | 'degraded';

export type ConflictResolution = 'ticket_priority' | 'server_priority' | 'manual';

export interface OfflineQueueEntry {
  id: string;                          // UUID v4 unique global
  type: OfflineEntryType;
  timestamp: string;                   // ISO 8601 avec timezone
  timezone: string;                    // ex: 'Europe/Paris'
  status: SyncStatus;
  retryCount: number;
  maxRetries: number;
  payload: any;                        // Données métier (ticket, paiement, etc.)
  cashierId: string;
  cashierName: string;
  storeId: string;
  conflictDetails?: string;
  syncedAt?: string;
  createdOffline: boolean;
}

export interface OfflineFraudGuard {
  // Limites quotidiennes par caissier en mode offline
  maxVoidsPerDayPerCashier: number;
  maxCashRefundMinorUnits: number;    // Seuil remboursement espèces offline
  maxTicketValueMinorUnits: number;   // Montant max par ticket offline
  maxConsecutiveVoids: number;        // Annulations consécutives max
  alertOnResync: boolean;             // Alerte manager après resync
}

export interface OfflineCashierTracker {
  cashierId: string;
  voidsToday: number;
  cashRefundsToday: number;           // minor units total
  consecutiveVoids: number;
  ticketsToday: number;
  lastActionTimestamp: string;
  anomalies: string[];
}

export interface ConflictEntry {
  id: string;
  queueEntryId: string;
  type: string;
  description: string;
  localData: any;
  serverData: any;
  resolution: ConflictResolution;
  resolvedAt?: string;
  resolvedBy?: string;
}

// ── TPE Configuration ──

export type TpeMode = 'autonomous' | 'internet_dependent';

export interface TpeConfig {
  mode: TpeMode;
  // Si autonomous : le TPE a sa propre connexion (4G/ethernet)
  // Si internet_dependent : le TPE dépend de la connexion Internet de la caisse
}

// ── State ──

interface OfflineState {
  // Network
  networkStatus: NetworkStatus;
  lastOnlineAt: string | null;
  lastOfflineAt: string | null;
  offlineSince: string | null;         // Début de la coupure courante

  // Queue
  queue: OfflineQueueEntry[];
  pendingCount: number;
  syncedCount: number;
  conflictCount: number;

  // Payment availability
  paymentAvailability: PaymentAvailability;
  tpeConfig: TpeConfig;

  // Fraud guards
  fraudGuard: OfflineFraudGuard;
  cashierTrackers: Record<string, OfflineCashierTracker>;

  // Conflicts
  conflicts: ConflictEntry[];

  // Sync state
  isSyncing: boolean;
  syncProgress: number;                // 0-100
  lastSyncAt: string | null;
  syncErrors: string[];

  // Local stock cache (decremented offline)
  localStockCache: Record<string, number>;  // productId -> quantité restante

  // Actions — Network
  setNetworkStatus: (status: NetworkStatus) => void;
  goOffline: () => void;
  goOnline: () => void;

  // Actions — Queue
  enqueue: (entry: Omit<OfflineQueueEntry, 'id' | 'timestamp' | 'timezone' | 'status' | 'retryCount' | 'maxRetries' | 'createdOffline'>) => string;
  updateEntryStatus: (id: string, status: SyncStatus, details?: string) => void;
  removeEntry: (id: string) => void;
  clearSyncedEntries: () => void;

  // Actions — Fraud
  trackVoid: (cashierId: string) => { allowed: boolean; reason?: string };
  trackCashRefund: (cashierId: string, amountMinorUnits: number) => { allowed: boolean; reason?: string };
  checkTicketLimit: (amountMinorUnits: number) => { allowed: boolean; reason?: string };
  resetDailyTrackers: () => void;
  resetConsecutiveVoids: (cashierId: string) => void;
  getAnomaliesForResync: () => OfflineCashierTracker[];

  // Actions — Stock
  decrementLocalStock: (productId: string, qty: number) => void;
  setLocalStockCache: (cache: Record<string, number>) => void;

  // Actions — Conflicts
  addConflict: (conflict: Omit<ConflictEntry, 'id'>) => void;
  resolveConflict: (conflictId: string, resolution: ConflictResolution, resolvedBy: string) => void;

  // Actions — Sync
  setSyncing: (syncing: boolean) => void;
  setSyncProgress: (progress: number) => void;
  setLastSyncAt: (at: string) => void;
  addSyncError: (error: string) => void;
  clearSyncErrors: () => void;

  // Actions — TPE
  setTpeConfig: (config: TpeConfig) => void;
  updatePaymentAvailability: () => void;

  // Computed
  getPendingEntries: () => OfflineQueueEntry[];
  getEntriesByType: (type: OfflineEntryType) => OfflineQueueEntry[];

  // Persistence
  persistQueue: () => void;
  persistTrackers: () => void;
  loadPersistedQueue: () => void;
}

// ── UUID generator (crypto-safe) ──

function generateUUID(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  // Fallback with crypto.getRandomValues (still secure)
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40; // Version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // Variant 1
  return Array.from(bytes)
    .map((b, i) => ([4, 6, 8, 10].includes(i) ? '-' : '') + b.toString(16).padStart(2, '0'))
    .join('');
}

// ── Local Storage Keys ──

const QUEUE_STORAGE_KEY = 'caisse_offline_queue';
const TRACKERS_STORAGE_KEY = 'caisse_offline_trackers';
const STOCK_CACHE_KEY = 'caisse_offline_stock';
const CONFLICTS_STORAGE_KEY = 'caisse_offline_conflicts';

// ── Default fraud guard config ──

const DEFAULT_FRAUD_GUARD: OfflineFraudGuard = {
  maxVoidsPerDayPerCashier: 5,
  maxCashRefundMinorUnits: 5000,      // 50,00 €
  maxTicketValueMinorUnits: 50000,    // 500,00 €
  maxConsecutiveVoids: 2,
  alertOnResync: true,
};

// ── Store ──

export const useOfflineStore = create<OfflineState>((set, get) => ({
  // Initial state
  networkStatus: 'online',
  lastOnlineAt: new Date().toISOString(),
  lastOfflineAt: null,
  offlineSince: null,

  queue: [],
  pendingCount: 0,
  syncedCount: 0,
  conflictCount: 0,

  paymentAvailability: { cash: true, card: true, qr: true, wallet: true },
  tpeConfig: { mode: 'autonomous' },

  fraudGuard: DEFAULT_FRAUD_GUARD,
  cashierTrackers: {},
  conflicts: [],

  isSyncing: false,
  syncProgress: 0,
  lastSyncAt: null,
  syncErrors: [],

  localStockCache: {},

  // ── Network ──

  setNetworkStatus: (status) => {
    set({ networkStatus: status });
    get().updatePaymentAvailability();
  },

  goOffline: () => {
    const now = new Date().toISOString();
    set({
      networkStatus: 'offline',
      lastOfflineAt: now,
      offlineSince: now,
    });
    get().updatePaymentAvailability();
    // Log l'événement
    get().enqueue({
      type: 'antifraude_log',
      payload: { event: 'connection_lost', timestamp: now },
      cashierId: 'system',
      cashierName: 'Systeme',
      storeId: '',
    });
  },

  goOnline: () => {
    const now = new Date().toISOString();
    const offlineDuration = get().offlineSince
      ? Math.round((Date.now() - new Date(get().offlineSince!).getTime()) / 1000)
      : 0;
    set({
      networkStatus: 'online',
      lastOnlineAt: now,
      offlineSince: null,
    });
    get().updatePaymentAvailability();
    // Log l'événement
    get().enqueue({
      type: 'antifraude_log',
      payload: { event: 'connection_restored', timestamp: now, offlineDurationSeconds: offlineDuration },
      cashierId: 'system',
      cashierName: 'Systeme',
      storeId: '',
    });
  },

  // ── Queue ──

  enqueue: (entry) => {
    const id = generateUUID();
    const now = new Date();
    const newEntry: OfflineQueueEntry = {
      ...entry,
      id,
      timestamp: now.toISOString(),
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      status: 'local_pending',
      retryCount: 0,
      maxRetries: 5,
      createdOffline: get().networkStatus === 'offline',
    };
    const queue = [...get().queue, newEntry];
    const pendingCount = queue.filter((e) => e.status === 'local_pending').length;
    set({ queue, pendingCount });
    get().persistQueue();
    return id;
  },

  updateEntryStatus: (id, status, details) => {
    const queue = get().queue.map((e) =>
      e.id === id
        ? {
            ...e,
            status,
            conflictDetails: details || e.conflictDetails,
            syncedAt: status === 'synced' ? new Date().toISOString() : e.syncedAt,
            retryCount: status === 'failed' ? e.retryCount + 1 : e.retryCount,
          }
        : e,
    );
    set({
      queue,
      pendingCount: queue.filter((e) => e.status === 'local_pending').length,
      syncedCount: queue.filter((e) => e.status === 'synced').length,
      conflictCount: queue.filter((e) => e.status === 'conflict').length,
    });
    get().persistQueue();
  },

  removeEntry: (id) => {
    const queue = get().queue.filter((e) => e.id !== id);
    set({
      queue,
      pendingCount: queue.filter((e) => e.status === 'local_pending').length,
    });
    get().persistQueue();
  },

  clearSyncedEntries: () => {
    const queue = get().queue.filter((e) => e.status !== 'synced');
    set({ queue, syncedCount: 0 });
    get().persistQueue();
  },

  // ── Fraud Guards ──

  trackVoid: (cashierId) => {
    const { fraudGuard, cashierTrackers } = get();
    const tracker = cashierTrackers[cashierId] || {
      cashierId,
      voidsToday: 0,
      cashRefundsToday: 0,
      consecutiveVoids: 0,
      ticketsToday: 0,
      lastActionTimestamp: '',
      anomalies: [],
    };

    // Check limits
    if (tracker.voidsToday >= fraudGuard.maxVoidsPerDayPerCashier) {
      return { allowed: false, reason: `Limite annulations offline atteinte (${fraudGuard.maxVoidsPerDayPerCashier}/jour)` };
    }
    if (tracker.consecutiveVoids >= fraudGuard.maxConsecutiveVoids) {
      return { allowed: false, reason: `Trop d'annulations consecutives (max ${fraudGuard.maxConsecutiveVoids})` };
    }

    // Update tracker
    const updated = {
      ...tracker,
      voidsToday: tracker.voidsToday + 1,
      consecutiveVoids: tracker.consecutiveVoids + 1,
      lastActionTimestamp: new Date().toISOString(),
    };

    // Flag anomaly if hitting 80% of limit
    if (updated.voidsToday >= fraudGuard.maxVoidsPerDayPerCashier * 0.8) {
      updated.anomalies = [...updated.anomalies, `Annulations proches du seuil: ${updated.voidsToday}/${fraudGuard.maxVoidsPerDayPerCashier}`];
    }

    set({
      cashierTrackers: { ...cashierTrackers, [cashierId]: updated },
    });
    get().persistTrackers();
    return { allowed: true };
  },

  trackCashRefund: (cashierId, amountMinorUnits) => {
    const { fraudGuard, cashierTrackers } = get();
    const tracker = cashierTrackers[cashierId] || {
      cashierId,
      voidsToday: 0,
      cashRefundsToday: 0,
      consecutiveVoids: 0,
      ticketsToday: 0,
      lastActionTimestamp: '',
      anomalies: [],
    };

    const newTotal = tracker.cashRefundsToday + amountMinorUnits;
    if (newTotal > fraudGuard.maxCashRefundMinorUnits) {
      return {
        allowed: false,
        reason: `Seuil remboursement especes offline depasse (max ${(fraudGuard.maxCashRefundMinorUnits / 100).toFixed(2)}€)`,
      };
    }

    const updated = {
      ...tracker,
      cashRefundsToday: newTotal,
      lastActionTimestamp: new Date().toISOString(),
    };

    if (newTotal >= fraudGuard.maxCashRefundMinorUnits * 0.7) {
      updated.anomalies = [...updated.anomalies, `Remboursements especes eleves: ${(newTotal / 100).toFixed(2)}€`];
    }

    set({
      cashierTrackers: { ...cashierTrackers, [cashierId]: updated },
    });
    get().persistTrackers();
    return { allowed: true };
  },

  checkTicketLimit: (amountMinorUnits) => {
    const { fraudGuard } = get();
    if (amountMinorUnits > fraudGuard.maxTicketValueMinorUnits) {
      return {
        allowed: false,
        reason: `Montant ticket depasse le seuil offline (max ${(fraudGuard.maxTicketValueMinorUnits / 100).toFixed(2)}€)`,
      };
    }
    return { allowed: true };
  },

  resetDailyTrackers: () => {
    set({ cashierTrackers: {} });
    get().persistTrackers();
  },

  resetConsecutiveVoids: (cashierId) => {
    const { cashierTrackers } = get();
    const tracker = cashierTrackers[cashierId];
    if (tracker) {
      set({
        cashierTrackers: {
          ...cashierTrackers,
          [cashierId]: { ...tracker, consecutiveVoids: 0, ticketsToday: tracker.ticketsToday + 1 },
        },
      });
      get().persistTrackers();
    }
  },

  getAnomaliesForResync: () => {
    return Object.values(get().cashierTrackers).filter(
      (t) => t.anomalies.length > 0 || t.voidsToday > 0 || t.cashRefundsToday > 0,
    );
  },

  // ── Stock ──

  decrementLocalStock: (productId, qty) => {
    const cache = { ...get().localStockCache };
    const current = cache[productId] || 0;
    cache[productId] = current - qty;
    if (cache[productId] < 0) {
      console.warn(`[OFFLINE] Stock negatif pour ${productId}: ${cache[productId]} (etait ${current}, decremente de ${qty})`);
    }
    set({ localStockCache: cache });
    try {
      localStorage.setItem(STOCK_CACHE_KEY, JSON.stringify(cache));
    } catch (e) { /* storage full — degrade gracefully */ }
  },

  setLocalStockCache: (cache) => {
    set({ localStockCache: cache });
    try {
      localStorage.setItem(STOCK_CACHE_KEY, JSON.stringify(cache));
    } catch (e) { /* storage full */ }
  },

  // ── Conflicts ──

  addConflict: (conflict) => {
    const id = generateUUID();
    const conflicts = [...get().conflicts, { ...conflict, id }];
    set({ conflicts, conflictCount: conflicts.length });
    try {
      localStorage.setItem(CONFLICTS_STORAGE_KEY, JSON.stringify(conflicts));
    } catch (e) { /* storage full */ }
  },

  resolveConflict: (conflictId, resolution, resolvedBy) => {
    const conflicts = get().conflicts.map((c) =>
      c.id === conflictId
        ? { ...c, resolution, resolvedAt: new Date().toISOString(), resolvedBy }
        : c,
    );
    set({ conflicts, conflictCount: conflicts.filter((c) => !c.resolvedAt).length });
    try {
      localStorage.setItem(CONFLICTS_STORAGE_KEY, JSON.stringify(conflicts));
    } catch (e) { /* storage full */ }
  },

  // ── Sync ──

  setSyncing: (syncing) => set({ isSyncing: syncing }),
  setSyncProgress: (progress) => set({ syncProgress: progress }),
  setLastSyncAt: (at) => set({ lastSyncAt: at }),
  addSyncError: (error) => set({ syncErrors: [...get().syncErrors, error] }),
  clearSyncErrors: () => set({ syncErrors: [] }),

  // ── TPE ──

  setTpeConfig: (config) => {
    set({ tpeConfig: config });
    get().updatePaymentAvailability();
  },

  updatePaymentAvailability: () => {
    const { networkStatus, tpeConfig } = get();
    const isOnline = networkStatus === 'online';

    set({
      paymentAvailability: {
        cash: true,                                              // TOUJOURS disponible
        card: isOnline || tpeConfig.mode === 'autonomous',       // Si TPE autonome OU online
        qr: isOnline,                                            // Requiert Internet
        wallet: isOnline,                                        // Requiert Internet
      },
    });
  },

  // ── Computed ──

  getPendingEntries: () => get().queue.filter((e) => e.status === 'local_pending'),

  getEntriesByType: (type) => get().queue.filter((e) => e.type === type),

  // ── Persistence (localStorage for Electron, survives app restart) ──

  persistQueue: () => {
    try {
      const queue = get().queue;
      // Serialize first — if this fails, don't corrupt localStorage
      const serialized = JSON.stringify(queue);
      localStorage.setItem(QUEUE_STORAGE_KEY, serialized);
    } catch (e: any) {
      if (e?.name === 'QuotaExceededError') {
        // Storage full — remove oldest synced entries and retry
        const queue = get().queue.filter((entry) => entry.status !== 'synced');
        try {
          localStorage.setItem(QUEUE_STORAGE_KEY, JSON.stringify(queue));
          set({ queue, syncedCount: 0 });
          console.warn('[OFFLINE] Storage quota exceeded — cleared synced entries');
        } catch {
          console.error('[OFFLINE] CRITICAL: Cannot persist queue even after cleanup');
        }
      } else {
        console.error('[OFFLINE] Failed to persist queue:', e);
      }
    }
  },

  persistTrackers: () => {
    try {
      localStorage.setItem(TRACKERS_STORAGE_KEY, JSON.stringify(get().cashierTrackers));
    } catch (e) {
      console.error('[OFFLINE] Failed to persist trackers:', e);
    }
  },

  loadPersistedQueue: () => {
    try {
      const queueStr = localStorage.getItem(QUEUE_STORAGE_KEY);
      const trackersStr = localStorage.getItem(TRACKERS_STORAGE_KEY);
      const stockStr = localStorage.getItem(STOCK_CACHE_KEY);
      const conflictsStr = localStorage.getItem(CONFLICTS_STORAGE_KEY);

      const queue: OfflineQueueEntry[] = queueStr ? JSON.parse(queueStr) : [];
      const cashierTrackers = trackersStr ? JSON.parse(trackersStr) : {};
      const localStockCache = stockStr ? JSON.parse(stockStr) : {};
      const conflicts: ConflictEntry[] = conflictsStr ? JSON.parse(conflictsStr) : [];

      set({
        queue,
        cashierTrackers,
        localStockCache,
        conflicts,
        pendingCount: queue.filter((e) => e.status === 'local_pending').length,
        syncedCount: queue.filter((e) => e.status === 'synced').length,
        conflictCount: conflicts.filter((c) => !c.resolvedAt).length,
      });

      console.log(`[OFFLINE] Loaded ${queue.length} entries from local storage (${queue.filter((e) => e.status === 'local_pending').length} pending)`);
    } catch (e) {
      console.error('[OFFLINE] Failed to load persisted data:', e);
    }
  },
}));
