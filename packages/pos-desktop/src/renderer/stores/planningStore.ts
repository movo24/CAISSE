import { create } from 'zustand';

/* ═══════════════════════════════════════════════════════════════
   PLANNING STORE — Planning semaine cached côté POS
   Offline-first : fetch au login, cache localStorage
   Affiche le shift du jour + alertes hors créneau
   ═══════════════════════════════════════════════════════════════ */

// ── Types ──

export interface PlannedShift {
  id: string;
  employeeId: string;
  employeeName: string;
  date: string;         // YYYY-MM-DD
  dayOfWeek: number;    // 0=Dim, 1=Lun, ..., 6=Sam
  startTime: string;    // HH:mm (ex: "09:00")
  endTime: string;      // HH:mm (ex: "17:30")
  breakMinutes: number; // Pause prévue en minutes
  type: 'regular' | 'overtime' | 'holiday' | 'training';
  notes: string;
}

export interface WeekPlanning {
  weekStart: string;    // YYYY-MM-DD (lundi)
  weekEnd: string;      // YYYY-MM-DD (dimanche)
  shifts: PlannedShift[];
  fetchedAt: string;    // ISO 8601
}

// ── localStorage key ──

const LS_PLANNING = 'caisse_planning_cache';

// ── Helpers ──

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

function currentTimeMinutes(): number {
  const now = new Date();
  return now.getHours() * 60 + now.getMinutes();
}

function timeToMinutes(t: string): number {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

function formatMinutes(m: number): string {
  const h = Math.floor(m / 60);
  const mins = m % 60;
  return `${h}h${mins > 0 ? String(mins).padStart(2, '0') : '00'}`;
}

// ── State ──

interface PlanningState {
  weekPlanning: WeekPlanning | null;

  // Actions
  setWeekPlanning: (planning: WeekPlanning) => void;
  loadFromCache: () => boolean;
  clearPlanning: () => void;

  // Computed
  getTodayShift: () => PlannedShift | null;
  isOutsidePlannedShift: () => boolean;
  isBeforeShift: () => boolean;
  isAfterShift: () => boolean;
  getRemainingMinutes: () => number;
  getShiftProgress: () => number;     // 0–100
  getWeekHoursPlanned: () => number;  // heures décimales
}

export const usePlanningStore = create<PlanningState>((set, get) => ({
  weekPlanning: null,

  setWeekPlanning: (planning) => {
    set({ weekPlanning: planning });
    try {
      localStorage.setItem(LS_PLANNING, JSON.stringify(planning));
    } catch { /* quota */ }
  },

  loadFromCache: () => {
    try {
      const raw = localStorage.getItem(LS_PLANNING);
      if (!raw) return false;
      const planning = JSON.parse(raw) as WeekPlanning;
      // Vérifier que c'est la semaine courante (ou récent)
      const daysSinceCache = Math.abs(
        (Date.now() - new Date(planning.fetchedAt).getTime()) / (1000 * 60 * 60 * 24),
      );
      if (daysSinceCache > 14) {
        // Cache trop ancien
        localStorage.removeItem(LS_PLANNING);
        return false;
      }
      set({ weekPlanning: planning });
      return true;
    } catch {
      return false;
    }
  },

  clearPlanning: () => {
    set({ weekPlanning: null });
    try {
      localStorage.removeItem(LS_PLANNING);
    } catch { /* ignore */ }
  },

  getTodayShift: () => {
    const wp = get().weekPlanning;
    if (!wp) return null;
    const today = todayStr();
    return wp.shifts.find((s) => s.date === today) || null;
  },

  isOutsidePlannedShift: () => {
    const shift = get().getTodayShift();
    if (!shift) return false; // Pas de shift = on ne peut pas dire "hors créneau"
    const now = currentTimeMinutes();
    const start = timeToMinutes(shift.startTime);
    const end = timeToMinutes(shift.endTime);
    return now < start || now > end;
  },

  isBeforeShift: () => {
    const shift = get().getTodayShift();
    if (!shift) return false;
    return currentTimeMinutes() < timeToMinutes(shift.startTime);
  },

  isAfterShift: () => {
    const shift = get().getTodayShift();
    if (!shift) return false;
    return currentTimeMinutes() > timeToMinutes(shift.endTime);
  },

  getRemainingMinutes: () => {
    const shift = get().getTodayShift();
    if (!shift) return 0;
    const end = timeToMinutes(shift.endTime);
    const now = currentTimeMinutes();
    return Math.max(0, end - now);
  },

  getShiftProgress: () => {
    const shift = get().getTodayShift();
    if (!shift) return 0;
    const start = timeToMinutes(shift.startTime);
    const end = timeToMinutes(shift.endTime);
    const now = currentTimeMinutes();
    const total = end - start;
    if (total <= 0) return 0;
    const elapsed = now - start;
    return Math.min(100, Math.max(0, Math.round((elapsed / total) * 100)));
  },

  getWeekHoursPlanned: () => {
    const wp = get().weekPlanning;
    if (!wp) return 0;
    let totalMinutes = 0;
    for (const s of wp.shifts) {
      const start = timeToMinutes(s.startTime);
      const end = timeToMinutes(s.endTime);
      totalMinutes += Math.max(0, end - start - s.breakMinutes);
    }
    return Math.round((totalMinutes / 60) * 10) / 10;
  },
}));

