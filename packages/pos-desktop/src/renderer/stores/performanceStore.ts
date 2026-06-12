import { create } from 'zustand';
import { useOfflineStore } from './offlineStore';
import type { PaymentMethod } from '../services/paymentMachine';

/* ═══════════════════════════════════════════════════════════════
   PERFORMANCE STORE — Métriques session caissier
   Tracking silencieux : CA, tickets, vitesse, paniers, annulations
   Offline-first : localStorage + sync queue
   ═══════════════════════════════════════════════════════════════ */

// ── Types ──

export interface TransactionRecord {
  ticketNumber: string;
  timestamp: string;          // ISO 8601
  totalMinorUnits: number;
  itemCount: number;
  durationSeconds: number;    // Temps entre 1er scan et paiement validé
  paymentMethod: PaymentMethod;
  discountMinorUnits: number;
  wasVoided: boolean;
}

export interface CashierSessionMetrics {
  // Identité
  sessionId: string;
  employeeId: string;
  employeeName: string;
  storeId: string;
  sessionStartedAt: string;   // ISO 8601

  // Compteurs cumulés
  totalRevenue: number;           // centimes
  totalDiscount: number;          // centimes
  ticketCount: number;
  itemCount: number;
  voidCount: number;
  voidAmount: number;             // centimes

  // Vitesse
  totalTransactionSeconds: number; // Somme des durées de toutes les transactions
  fastestTransactionSeconds: number;
  slowestTransactionSeconds: number;

  // Panier
  highestTicket: number;          // centimes
  lowestTicket: number;           // centimes (hors annulations)

  // Historique intra-session (pour calculs horaires)
  transactions: TransactionRecord[];

  // Sync
  lastSyncedAt: string | null;
}

// ── localStorage key ──

const LS_METRICS = 'caisse_cashier_metrics';

// ── Helpers ──

const uid = () => `session-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;

// ── State ──

interface PerformanceState {
  session: CashierSessionMetrics | null;

  // Actions
  initSession: (employeeId: string, employeeName: string, storeId: string) => void;
  recordTransaction: (tx: Omit<TransactionRecord, 'wasVoided'>) => void;
  recordVoid: (ticketNumber: string, amountMinorUnits: number) => void;

  // Computed
  getAverageBasket: () => number;
  getAverageSpeed: () => number;          // secondes par transaction
  getItemsPerMinute: () => number;
  getTicketsPerHour: () => number;
  getRevenuePerHour: () => number;        // centimes
  getHourlySplit: () => { hour: string; revenue: number; tickets: number }[];
  getVoidRate: () => number;              // pourcentage

  // Persistence
  persist: () => void;
  loadPersistedData: () => void;
  flushToSyncQueue: () => void;
  clearSession: () => void;
}

export const usePerformanceStore = create<PerformanceState>((set, get) => ({
  session: null,

  // ── Init session (appelé au login) ──
  initSession: (employeeId, employeeName, storeId) => {
    const now = new Date().toISOString();
    const session: CashierSessionMetrics = {
      sessionId: uid(),
      employeeId,
      employeeName,
      storeId,
      sessionStartedAt: now,
      totalRevenue: 0,
      totalDiscount: 0,
      ticketCount: 0,
      itemCount: 0,
      voidCount: 0,
      voidAmount: 0,
      totalTransactionSeconds: 0,
      fastestTransactionSeconds: Infinity,
      slowestTransactionSeconds: 0,
      highestTicket: 0,
      lowestTicket: Infinity,
      transactions: [],
      lastSyncedAt: null,
    };
    set({ session });
    get().persist();
    console.log(`[PERF] Session initialized for ${employeeName} (${sessionId(session)})`);
  },

  // ── Enregistrer une transaction (après chaque paiement réussi) ──
  recordTransaction: (tx) => {
    const session = get().session;
    if (!session) return;

    const record: TransactionRecord = { ...tx, wasVoided: false };

    const updated: CashierSessionMetrics = {
      ...session,
      totalRevenue: session.totalRevenue + tx.totalMinorUnits,
      totalDiscount: session.totalDiscount + tx.discountMinorUnits,
      ticketCount: session.ticketCount + 1,
      itemCount: session.itemCount + tx.itemCount,
      totalTransactionSeconds: session.totalTransactionSeconds + tx.durationSeconds,
      fastestTransactionSeconds: Math.min(session.fastestTransactionSeconds, tx.durationSeconds),
      slowestTransactionSeconds: Math.max(session.slowestTransactionSeconds, tx.durationSeconds),
      highestTicket: Math.max(session.highestTicket, tx.totalMinorUnits),
      lowestTicket: Math.min(session.lowestTicket, tx.totalMinorUnits),
      transactions: [...session.transactions, record],
    };

    set({ session: updated });
    get().persist();
  },

  // ── Enregistrer une annulation ──
  recordVoid: (ticketNumber, amountMinorUnits) => {
    const session = get().session;
    if (!session) return;

    // Business invariant: a void must reference a KNOWN ticket. An unknown
    // ticketNumber is a clean no-op (no voidCount/voidAmount increment, no phantom
    // ticket) so void counters can never over-count vs the recorded tickets.
    const known = session.transactions.some((t) => t.ticketNumber === ticketNumber);
    if (!known) return;

    const updated: CashierSessionMetrics = {
      ...session,
      voidCount: session.voidCount + 1,
      voidAmount: session.voidAmount + amountMinorUnits,
      transactions: session.transactions.map((t) =>
        t.ticketNumber === ticketNumber ? { ...t, wasVoided: true } : t,
      ),
    };

    set({ session: updated });
    get().persist();
  },

  // ── Computed ──

  getAverageBasket: () => {
    const s = get().session;
    if (!s || s.ticketCount === 0) return 0;
    return Math.round(s.totalRevenue / s.ticketCount);
  },

  getAverageSpeed: () => {
    const s = get().session;
    if (!s || s.ticketCount === 0) return 0;
    return Math.round(s.totalTransactionSeconds / s.ticketCount);
  },

  getItemsPerMinute: () => {
    const s = get().session;
    if (!s || s.totalTransactionSeconds === 0) return 0;
    return Math.round((s.itemCount / s.totalTransactionSeconds) * 60 * 10) / 10;
  },

  getTicketsPerHour: () => {
    const s = get().session;
    if (!s) return 0;
    const sessionMinutes = Math.max(1, minutesSince(s.sessionStartedAt));
    return Math.round((s.ticketCount / sessionMinutes) * 60 * 10) / 10;
  },

  getRevenuePerHour: () => {
    const s = get().session;
    if (!s) return 0;
    const sessionMinutes = Math.max(1, minutesSince(s.sessionStartedAt));
    return Math.round((s.totalRevenue / sessionMinutes) * 60);
  },

  getHourlySplit: () => {
    const s = get().session;
    if (!s) return [];
    const map: Record<string, { revenue: number; tickets: number }> = {};
    for (const tx of s.transactions) {
      if (tx.wasVoided) continue;
      const h = new Date(tx.timestamp).getHours();
      const key = `${h}h`;
      if (!map[key]) map[key] = { revenue: 0, tickets: 0 };
      map[key].revenue += tx.totalMinorUnits;
      map[key].tickets += 1;
    }
    return Object.entries(map)
      .sort(([a], [b]) => parseInt(a) - parseInt(b))
      .map(([hour, data]) => ({ hour, ...data }));
  },

  getVoidRate: () => {
    const s = get().session;
    if (!s || s.ticketCount === 0) return 0;
    return Math.round((s.voidCount / (s.ticketCount + s.voidCount)) * 100 * 10) / 10;
  },

  // ── Persistence ──

  persist: () => {
    const { session } = get();
    try {
      if (session) {
        localStorage.setItem(LS_METRICS, JSON.stringify(session));
      } else {
        localStorage.removeItem(LS_METRICS);
      }
    } catch { /* quota */ }
  },

  loadPersistedData: () => {
    try {
      const raw = localStorage.getItem(LS_METRICS);
      if (raw) {
        const session = JSON.parse(raw) as CashierSessionMetrics;
        // Vérifier que la session est du même jour
        const todayStr = new Date().toISOString().slice(0, 10);
        const sessionDay = session.sessionStartedAt.slice(0, 10);
        if (sessionDay === todayStr) {
          set({ session });
          console.log(`[PERF] Restored session: ${session.ticketCount} tickets, ${(session.totalRevenue / 100).toFixed(2)}€`);
        } else {
          // Session d'un autre jour → flush puis clear
          console.log('[PERF] Stale session from previous day — flushing and clearing');
          set({ session }); // set temporairement pour flush
          get().flushToSyncQueue();
          get().clearSession();
        }
      }
    } catch { /* corrupted — start fresh */ }
  },

  flushToSyncQueue: () => {
    const session = get().session;
    if (!session || session.ticketCount === 0) return;

    const offline = useOfflineStore.getState();
    offline.enqueue({
      type: 'cashier_metrics',
      storeId: session.storeId,
      cashierId: session.employeeId,
      cashierName: session.employeeName,
      payload: {
        sessionId: session.sessionId,
        employeeId: session.employeeId,
        employeeName: session.employeeName,
        storeId: session.storeId,
        sessionStartedAt: session.sessionStartedAt,
        flushedAt: new Date().toISOString(),
        totalRevenue: session.totalRevenue,
        totalDiscount: session.totalDiscount,
        ticketCount: session.ticketCount,
        itemCount: session.itemCount,
        voidCount: session.voidCount,
        voidAmount: session.voidAmount,
        avgTransactionSeconds: session.ticketCount > 0
          ? Math.round(session.totalTransactionSeconds / session.ticketCount)
          : 0,
        fastestTransactionSeconds: session.fastestTransactionSeconds === Infinity ? 0 : session.fastestTransactionSeconds,
        slowestTransactionSeconds: session.slowestTransactionSeconds,
        avgBasket: session.ticketCount > 0 ? Math.round(session.totalRevenue / session.ticketCount) : 0,
        highestTicket: session.highestTicket,
        lowestTicket: session.lowestTicket === Infinity ? 0 : session.lowestTicket,
      },
    });

    set((s) => ({
      session: s.session ? { ...s.session, lastSyncedAt: new Date().toISOString() } : null,
    }));
    get().persist();
    console.log(`[PERF] Session flushed to sync queue: ${session.ticketCount} tickets, ${(session.totalRevenue / 100).toFixed(2)}€`);
  },

  clearSession: () => {
    set({ session: null });
    try {
      localStorage.removeItem(LS_METRICS);
    } catch { /* ignore */ }
  },
}));

// ── Helpers internes ──

function minutesSince(isoDate: string): number {
  return Math.max(0, Math.round((Date.now() - new Date(isoDate).getTime()) / 60000));
}

function sessionId(s: CashierSessionMetrics): string {
  return s.sessionId.slice(0, 16);
}
