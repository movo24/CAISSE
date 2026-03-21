import { create } from 'zustand';

/**
 * Pointage Store — SIMPLIFIED
 *
 * Clock-in/out is now managed by TimeWin24 via /api/timewin/clock-in.
 * This store only tracks LOCAL shift display state for the POS UI.
 * No more offline queue for punches — TimeWin24 is the source of truth.
 */

export type PunchType = 'clock_in' | 'clock_out' | 'break_start' | 'break_end';

interface CurrentShift {
  clockInAt: string;
  breakStartAt: string | null;
  totalBreakMinutes: number;
}

const LS_SHIFT = 'caisse_pointage_current_shift';

function minutesBetween(a: string, b: string): number {
  return Math.max(0, Math.round((new Date(b).getTime() - new Date(a).getTime()) / 60000));
}

interface PointageState {
  currentShift: CurrentShift | null;

  /** Record clock-in locally for UI (TimeWin24 API called separately) */
  clockIn: (employeeId: string, employeeName: string, storeId: string) => void;
  clockOut: () => void;
  startBreak: () => void;
  endBreak: () => void;

  getShiftDurationMinutes: () => number;
  getBreakMinutes: () => number;
  isOnBreak: () => boolean;

  loadPersistedData: () => void;
  clearAll: () => void;
}

export const usePointageStore = create<PointageState>((set, get) => ({
  currentShift: null,

  clockIn: (_employeeId, _employeeName, _storeId) => {
    const now = new Date().toISOString();
    const shift: CurrentShift = { clockInAt: now, breakStartAt: null, totalBreakMinutes: 0 };
    set({ currentShift: shift });
    try { localStorage.setItem(LS_SHIFT, JSON.stringify(shift)); } catch {}
  },

  clockOut: () => {
    if (get().currentShift?.breakStartAt) get().endBreak();
    set({ currentShift: null });
    try { localStorage.removeItem(LS_SHIFT); } catch {}
  },

  startBreak: () => {
    const shift = get().currentShift;
    if (!shift || shift.breakStartAt) return;
    const now = new Date().toISOString();
    const updated = { ...shift, breakStartAt: now };
    set({ currentShift: updated });
    try { localStorage.setItem(LS_SHIFT, JSON.stringify(updated)); } catch {}
  },

  endBreak: () => {
    const shift = get().currentShift;
    if (!shift || !shift.breakStartAt) return;
    const breakDuration = minutesBetween(shift.breakStartAt, new Date().toISOString());
    const updated = {
      ...shift,
      breakStartAt: null,
      totalBreakMinutes: shift.totalBreakMinutes + breakDuration,
    };
    set({ currentShift: updated });
    try { localStorage.setItem(LS_SHIFT, JSON.stringify(updated)); } catch {}
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

  isOnBreak: () => get().currentShift?.breakStartAt != null,

  loadPersistedData: () => {
    try {
      const raw = localStorage.getItem(LS_SHIFT);
      set({ currentShift: raw ? JSON.parse(raw) : null });
    } catch { set({ currentShift: null }); }
  },

  clearAll: () => {
    set({ currentShift: null });
    try { localStorage.removeItem(LS_SHIFT); } catch {}
  },
}));
