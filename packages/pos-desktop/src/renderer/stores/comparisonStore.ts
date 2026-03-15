import { create } from 'zustand';

/* ═══════════════════════════════════════════════════════════════
   COMPARISON STORE — Live Store Performance Comparison
   Polling toutes les 5 minutes pour comparer les magasins du réseau.
   Pattern identique à staffingEngine.ts.
   ═══════════════════════════════════════════════════════════════ */

const POLL_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const STORAGE_KEY = 'caisse_comparison_state';

export interface InactiveAlert {
  storeName: string;
  minutesSinceLastSale: number;
}

export interface ComparisonData {
  myRank: number;
  totalStores: number;
  myRevenue: number;
  leaderRevenue: number;
  deltaPercent: number;
  myStoreName: string;
  leaderStoreName: string;
  inactiveAlerts: InactiveAlert[];
}

interface ComparisonState extends ComparisonData {
  lastFetchedAt: string | null;
  isLoading: boolean;
  error: string | null;
  isPolling: boolean;

  fetch: () => Promise<void>;
  startPolling: () => void;
  stopPolling: () => void;
}

let pollTimer: ReturnType<typeof setInterval> | null = null;

export const useComparisonStore = create<ComparisonState>((set, get) => ({
  myRank: 0,
  totalStores: 0,
  myRevenue: 0,
  leaderRevenue: 0,
  deltaPercent: 0,
  myStoreName: '',
  leaderStoreName: '',
  inactiveAlerts: [],
  lastFetchedAt: null,
  isLoading: false,
  error: null,
  isPolling: false,

  fetch: async () => {
    set({ isLoading: true, error: null });
    try {
      const API_URL = (import.meta as any).env?.VITE_API_URL || '';
      const token = localStorage.getItem('accessToken');
      const res = await fetch(`${API_URL}/api/live-performance/compact`, {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: ComparisonData = await res.json();

      const now = new Date().toISOString();
      set({
        ...data,
        lastFetchedAt: now,
        isLoading: false,
      });

      // Persist
      try {
        localStorage.setItem(
          STORAGE_KEY,
          JSON.stringify({ ...data, lastFetchedAt: now }),
        );
      } catch { /* localStorage full — ignore */ }
    } catch (err: any) {
      set({ isLoading: false, error: err.message || 'Erreur réseau' });
    }
  },

  startPolling: () => {
    if (get().isPolling) return;
    set({ isPolling: true });

    // Load persisted data if from today
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        const savedDate = parsed.lastFetchedAt?.slice(0, 10);
        const today = new Date().toISOString().slice(0, 10);
        if (savedDate === today) {
          set({ ...parsed, isLoading: false, error: null });
        } else {
          localStorage.removeItem(STORAGE_KEY);
        }
      }
    } catch { /* ignore corrupt data */ }

    // Fetch immediately then every 5 min
    get().fetch();
    pollTimer = setInterval(() => get().fetch(), POLL_INTERVAL_MS);
  },

  stopPolling: () => {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
    set({ isPolling: false });
  },
}));
