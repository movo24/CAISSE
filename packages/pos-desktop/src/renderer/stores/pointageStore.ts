import { create } from 'zustand';
import { useOfflineStore } from './offlineStore';

/* ── Types ── */

export type PunchType = 'clock_in' | 'clock_out' | 'break_start' | 'break_end';

export interface TimePunch {
  id: string;
  employeeId: string;
  employeeName: string;
  type: PunchType;
  timestamp: string; // ISO 8601
  storeId: string;
  source: 'auto_login' | 'auto_logout' | 'manual';
  syncStatus: 'local_pending' | 'synced';
}

interface CurrentShift {
  clockInAt: string;
  breakStartAt: string | null;
  totalBreakMinutes: number;
}

/* ── localStorage keys ── */

const LS_SHIFT = 'caisse_pointage_current_shift';
const LS_PUNCHES = 'caisse_pointage_punches';

/* ── Helpers ── */

const uid = () => `punch-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;

function minutesBetween(a: string, b: string): number {
  return Math.max(0, Math.round((new Date(b).getTime() - new Date(a).getTime()) / 60000));
}

/* ── Store ── */

interface PointageState {
  currentShift: CurrentShift | null;
  punches: TimePunch[];

  clockIn: (employeeId: string, employeeName: string, storeId: string, source?: 'auto_login' | 'manual') => void;
  clockOut: (employeeId: string, source?: 'auto_logout' | 'manual') => void;
  startBreak: (employeeId: string) => void;
  endBreak: (employeeId: string) => void;

  getShiftDurationMinutes: () => number;
  getBreakMinutes: () => number;
  isOnBreak: () => boolean;

  loadPersistedData: () => void;
  persist: () => void;
  clearAll: () => void;
}

export const usePointageStore = create<PointageState>((set, get) => ({
  currentShift: null,
  punches: [],

  clockIn: (employeeId, employeeName, storeId, source = 'auto_login') => {
    const now = new Date().toISOString();
    const punch: TimePunch = {
      id: uid(),
      employeeId,
      employeeName,
      type: 'clock_in',
      timestamp: now,
      storeId,
      source,
      syncStatus: 'local_pending',
    };

    const shift: CurrentShift = { clockInAt: now, breakStartAt: null, totalBreakMinutes: 0 };

    set((s) => ({
      currentShift: shift,
      punches: [...s.punches, punch],
    }));

    get().persist();
    enqueuePunch(punch);
  },

  clockOut: (employeeId, source = 'auto_logout') => {
    const state = get();
    if (!state.currentShift) return;

    // End active break if any
    if (state.currentShift.breakStartAt) {
      get().endBreak(employeeId);
    }

    const now = new Date().toISOString();
    const punch: TimePunch = {
      id: uid(),
      employeeId,
      employeeName: state.punches.find((p) => p.employeeId === employeeId)?.employeeName || 'Caissier',
      type: 'clock_out',
      timestamp: now,
      storeId: state.punches[0]?.storeId || '',
      source,
      syncStatus: 'local_pending',
    };

    set((s) => ({
      currentShift: null,
      punches: [...s.punches, punch],
    }));

    get().persist();
    enqueuePunch(punch);
  },

  startBreak: (employeeId) => {
    const state = get();
    if (!state.currentShift || state.currentShift.breakStartAt) return;

    const now = new Date().toISOString();
    const punch: TimePunch = {
      id: uid(),
      employeeId,
      employeeName: state.punches.find((p) => p.employeeId === employeeId)?.employeeName || 'Caissier',
      type: 'break_start',
      timestamp: now,
      storeId: state.punches[0]?.storeId || '',
      source: 'manual',
      syncStatus: 'local_pending',
    };

    set((s) => ({
      currentShift: s.currentShift ? { ...s.currentShift, breakStartAt: now } : null,
      punches: [...s.punches, punch],
    }));

    get().persist();
    enqueuePunch(punch);
  },

  endBreak: (employeeId) => {
    const state = get();
    if (!state.currentShift || !state.currentShift.breakStartAt) return;

    const now = new Date().toISOString();
    const breakDuration = minutesBetween(state.currentShift.breakStartAt, now);

    const punch: TimePunch = {
      id: uid(),
      employeeId,
      employeeName: state.punches.find((p) => p.employeeId === employeeId)?.employeeName || 'Caissier',
      type: 'break_end',
      timestamp: now,
      storeId: state.punches[0]?.storeId || '',
      source: 'manual',
      syncStatus: 'local_pending',
    };

    set((s) => ({
      currentShift: s.currentShift
        ? { ...s.currentShift, breakStartAt: null, totalBreakMinutes: s.currentShift.totalBreakMinutes + breakDuration }
        : null,
      punches: [...s.punches, punch],
    }));

    get().persist();
    enqueuePunch(punch);
  },

  getShiftDurationMinutes: () => {
    const shift = get().currentShift;
    if (!shift) return 0;
    const now = new Date().toISOString();
    const total = minutesBetween(shift.clockInAt, now);
    const currentBreak = shift.breakStartAt ? minutesBetween(shift.breakStartAt, now) : 0;
    return Math.max(0, total - shift.totalBreakMinutes - currentBreak);
  },

  getBreakMinutes: () => {
    const shift = get().currentShift;
    if (!shift) return 0;
    const currentBreak = shift.breakStartAt
      ? minutesBetween(shift.breakStartAt, new Date().toISOString())
      : 0;
    return shift.totalBreakMinutes + currentBreak;
  },

  isOnBreak: () => {
    const shift = get().currentShift;
    return shift?.breakStartAt !== null && shift?.breakStartAt !== undefined;
  },

  loadPersistedData: () => {
    try {
      const shiftRaw = localStorage.getItem(LS_SHIFT);
      const punchesRaw = localStorage.getItem(LS_PUNCHES);
      const currentShift = shiftRaw ? JSON.parse(shiftRaw) : null;
      const punches = punchesRaw ? JSON.parse(punchesRaw) : [];
      set({ currentShift, punches });
    } catch { /* corrupted — start fresh */ }
  },

  persist: () => {
    const { currentShift, punches } = get();
    try {
      if (currentShift) {
        localStorage.setItem(LS_SHIFT, JSON.stringify(currentShift));
      } else {
        localStorage.removeItem(LS_SHIFT);
      }
      // Keep only today's punches to avoid storage bloat
      const todayStr = new Date().toISOString().slice(0, 10);
      const todayPunches = punches.filter((p) => p.timestamp.slice(0, 10) === todayStr);
      localStorage.setItem(LS_PUNCHES, JSON.stringify(todayPunches));
    } catch { /* quota */ }
  },

  clearAll: () => {
    set({ currentShift: null, punches: [] });
    try {
      localStorage.removeItem(LS_SHIFT);
      localStorage.removeItem(LS_PUNCHES);
    } catch { /* ignore */ }
  },
}));

/* ── Enqueue punch to offline sync queue ── */

function enqueuePunch(punch: TimePunch) {
  const offline = useOfflineStore.getState();
  offline.enqueue({
    type: 'pointage',
    storeId: punch.storeId,
    cashierId: punch.employeeId,
    cashierName: punch.employeeName,
    payload: {
      id: punch.id,
      employeeId: punch.employeeId,
      employeeName: punch.employeeName,
      type: punch.type,
      timestamp: punch.timestamp,
      storeId: punch.storeId,
      source: punch.source,
    },
  });
}
