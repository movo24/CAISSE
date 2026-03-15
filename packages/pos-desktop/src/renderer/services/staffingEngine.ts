import { create } from 'zustand';
import { posEventBus, SaleCompletedPayload, SessionOpenedPayload, SessionClosedPayload } from './posEventBus';

/* ═══════════════════════════════════════════════════════════════
   STAFFING ENGINE — Moteur IA Live Staffing
   Analyse toutes les 5 minutes :
     - CA horaire reel vs previsionnel
     - Transactions vs capacite caisse
     - Recommandation ouverture/fermeture caisse
   Seuils intelligents pour eviter la fatigue d'alerte
   ═══════════════════════════════════════════════════════════════ */

// ── Types ──

export type StaffingLevel = 'optimal' | 'tension' | 'surcharge' | 'sous_effectif' | 'unknown';

export interface HourlyTarget {
  hour: number;           // 0-23
  revenueTarget: number;  // centimes — CA cible
  txCapacity: number;     // transactions max par caisse par heure
}

export interface ActiveCashier {
  cashierId: string;
  cashierName: string;
  sessionOpenedAt: string;
  lastActivityAt: string;
  txCount: number;
  revenue: number;        // centimes
}

export interface StaffingRecommendation {
  type: 'open_register' | 'close_register' | 'none';
  reason: string;
  urgency: 'low' | 'medium' | 'high';
  timestamp: string;
}

export interface HourlySnapshot {
  hour: number;
  revenue: number;        // centimes
  txCount: number;
  avgSpeed: number;       // seconds per tx
  activeCashiers: number;
}

// ── Constants — Seuils intelligents ──

const ANALYSIS_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const INACTIVITY_TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes → auto-close session

// Seuils pour eviter la fatigue d'alerte
const ALERT_COOLDOWN_MS = 10 * 60 * 1000; // 10 min min entre deux alertes du meme type
const SURCHARGE_TX_RATE = 0.85;            // >85% capacite → surcharge
const TENSION_TX_RATE = 0.70;              // >70% capacite → tension
const SOUS_EFFECTIF_REVENUE_RATIO = 0.60;  // <60% objectif avec 1 seule caisse → sous-effectif
const MIN_TX_FOR_ANALYSIS = 3;             // Minimum de transactions avant de generer une analyse

// ── Default hourly targets (fallback — override via backend /staffing/targets) ──

function buildDefaultTargets(): HourlyTarget[] {
  const targets: HourlyTarget[] = [];
  for (let h = 0; h < 24; h++) {
    let revenueTarget = 0;
    let txCapacity = 20; // transactions par caisse par heure

    if (h >= 9 && h < 12) {
      // Matin calme
      revenueTarget = 30000; // 300 EUR
      txCapacity = 20;
    } else if (h >= 12 && h < 14) {
      // Pause dejeuner — pic
      revenueTarget = 55000; // 550 EUR
      txCapacity = 30;
    } else if (h >= 14 && h < 17) {
      // Apres-midi moyen
      revenueTarget = 40000; // 400 EUR
      txCapacity = 25;
    } else if (h >= 17 && h < 20) {
      // Soir — pic sortie bureau
      revenueTarget = 60000; // 600 EUR
      txCapacity = 30;
    }

    targets.push({ hour: h, revenueTarget, txCapacity });
  }
  return targets;
}

// ── localStorage key ──

const LS_STAFFING = 'caisse_staffing_state';

// ── Store ──

interface StaffingState {
  // Status
  level: StaffingLevel;
  lastAnalysisAt: string | null;
  lastRecommendation: StaffingRecommendation | null;
  lastAlertTimestamps: Record<string, string>; // type → ISO timestamp

  // Live data
  activeCashiers: ActiveCashier[];
  hourlySnapshots: HourlySnapshot[];
  currentHourTx: number;
  currentHourRevenue: number;
  currentHourStart: number; // hour (0-23)

  // Targets
  hourlyTargets: HourlyTarget[];

  // Inactivity tracking
  lastGlobalActivity: string;

  // Engine state
  isRunning: boolean;
  analysisCount: number;

  // ── Actions ──
  start: (storeId: string) => void;
  stop: () => void;
  runAnalysis: () => StaffingRecommendation;
  registerCashier: (cashierId: string, cashierName: string) => void;
  unregisterCashier: (cashierId: string, reason: string) => void;
  recordSale: (sale: SaleCompletedPayload) => void;
  setHourlyTargets: (targets: HourlyTarget[]) => void;
  checkInactivity: () => string[]; // returns cashierIds to auto-close

  // ── Computed ──
  getCurrentTarget: () => HourlyTarget;
  getCapacityRate: () => number;        // 0-1
  getRevenueRate: () => number;         // 0-1 (reel / cible)
  getAvgSpeedCurrentHour: () => number; // seconds
  getTxPerHourPerCashier: () => number;

  // Persistence
  persist: () => void;
  loadPersistedData: () => void;
}

let analysisInterval: ReturnType<typeof setInterval> | null = null;
let inactivityInterval: ReturnType<typeof setInterval> | null = null;
let eventUnsubs: (() => void)[] = [];

export const useStaffingStore = create<StaffingState>((set, get) => ({
  level: 'unknown',
  lastAnalysisAt: null,
  lastRecommendation: null,
  lastAlertTimestamps: {},
  activeCashiers: [],
  hourlySnapshots: [],
  currentHourTx: 0,
  currentHourRevenue: 0,
  currentHourStart: new Date().getHours(),
  hourlyTargets: buildDefaultTargets(),
  lastGlobalActivity: new Date().toISOString(),
  isRunning: false,
  analysisCount: 0,

  // ── Start engine ──
  start: (storeId) => {
    const state = get();
    if (state.isRunning) return;

    console.log(`[STAFFING] Engine started for store ${storeId}`);

    // Subscribe to events
    const unsub1 = posEventBus.on('SALE_COMPLETED', (sale) => {
      get().recordSale(sale);
    });

    const unsub2 = posEventBus.on('SESSION_OPENED', (payload: SessionOpenedPayload) => {
      get().registerCashier(payload.cashierId, payload.cashierName);
    });

    const unsub3 = posEventBus.on('SESSION_CLOSED', (payload: SessionClosedPayload) => {
      get().unregisterCashier(payload.cashierId, payload.reason);
    });

    eventUnsubs = [unsub1, unsub2, unsub3];

    // Run analysis every 5 minutes
    if (analysisInterval) clearInterval(analysisInterval);
    analysisInterval = setInterval(() => {
      get().runAnalysis();
    }, ANALYSIS_INTERVAL_MS);

    // Check inactivity every 60 seconds
    if (inactivityInterval) clearInterval(inactivityInterval);
    inactivityInterval = setInterval(() => {
      get().checkInactivity();
    }, 60_000);

    set({ isRunning: true });

    // Run initial analysis after short delay
    setTimeout(() => {
      if (get().isRunning) get().runAnalysis();
    }, 10_000);
  },

  // ── Stop engine ──
  stop: () => {
    if (analysisInterval) { clearInterval(analysisInterval); analysisInterval = null; }
    if (inactivityInterval) { clearInterval(inactivityInterval); inactivityInterval = null; }
    eventUnsubs.forEach((fn) => fn());
    eventUnsubs = [];
    set({ isRunning: false });
    get().persist();
    console.log('[STAFFING] Engine stopped');
  },

  // ── Register cashier ──
  registerCashier: (cashierId, cashierName) => {
    const existing = get().activeCashiers.find((c) => c.cashierId === cashierId);
    if (existing) return; // Already registered

    const now = new Date().toISOString();
    set((s) => ({
      activeCashiers: [
        ...s.activeCashiers,
        { cashierId, cashierName, sessionOpenedAt: now, lastActivityAt: now, txCount: 0, revenue: 0 },
      ],
    }));
    get().persist();
    console.log(`[STAFFING] Cashier registered: ${cashierName} (${get().activeCashiers.length} active)`);
  },

  // ── Unregister cashier ──
  unregisterCashier: (cashierId, reason) => {
    const cashier = get().activeCashiers.find((c) => c.cashierId === cashierId);
    if (!cashier) return;

    set((s) => ({
      activeCashiers: s.activeCashiers.filter((c) => c.cashierId !== cashierId),
    }));
    get().persist();
    console.log(`[STAFFING] Cashier unregistered: ${cashier.cashierName} (reason: ${reason}, ${get().activeCashiers.length} active)`);
  },

  // ── Record sale ──
  recordSale: (sale) => {
    const now = new Date();
    const currentHour = now.getHours();

    set((s) => {
      // Reset hour counters if hour changed
      const hourReset = currentHour !== s.currentHourStart;
      const prevHourTx = hourReset ? s.currentHourTx : 0;
      const prevHourRevenue = hourReset ? s.currentHourRevenue : 0;

      // Snapshot previous hour if it rolled
      let snapshots = [...s.hourlySnapshots];
      if (hourReset && s.currentHourTx > 0) {
        snapshots.push({
          hour: s.currentHourStart,
          revenue: s.currentHourRevenue,
          txCount: s.currentHourTx,
          avgSpeed: 0, // calculated later
          activeCashiers: s.activeCashiers.length,
        });
        // Keep only last 24 snapshots
        if (snapshots.length > 24) snapshots = snapshots.slice(-24);
      }

      // Update cashier stats
      const cashiers = s.activeCashiers.map((c) =>
        c.cashierId === sale.cashierId
          ? {
              ...c,
              lastActivityAt: sale.timestamp,
              txCount: c.txCount + 1,
              revenue: c.revenue + sale.totalMinorUnits,
            }
          : c,
      );

      return {
        currentHourTx: (hourReset ? 0 : s.currentHourTx) + 1,
        currentHourRevenue: (hourReset ? 0 : s.currentHourRevenue) + sale.totalMinorUnits,
        currentHourStart: currentHour,
        hourlySnapshots: snapshots,
        activeCashiers: cashiers,
        lastGlobalActivity: sale.timestamp,
      };
    });

    get().persist();
  },

  // ── Core analysis ──
  runAnalysis: () => {
    const s = get();
    const activeCashierCount = s.activeCashiers.length;
    const target = s.getCurrentTarget();
    const now = new Date().toISOString();

    // Not enough data yet
    if (s.currentHourTx < MIN_TX_FOR_ANALYSIS && activeCashierCount <= 1) {
      const rec: StaffingRecommendation = { type: 'none', reason: 'Pas assez de donnees', urgency: 'low', timestamp: now };
      set({ lastAnalysisAt: now, lastRecommendation: rec, analysisCount: s.analysisCount + 1 });
      return rec;
    }

    const capacityRate = s.getCapacityRate();
    const revenueRate = s.getRevenueRate();

    let level: StaffingLevel = 'optimal';
    let rec: StaffingRecommendation = { type: 'none', reason: 'Effectif adapte a la charge', urgency: 'low', timestamp: now };

    // ── Surcharge detection ──
    if (capacityRate > SURCHARGE_TX_RATE) {
      level = 'surcharge';
      rec = {
        type: 'open_register',
        reason: `Capacite a ${Math.round(capacityRate * 100)}% — temps d'attente eleve`,
        urgency: 'high',
        timestamp: now,
      };
    }
    // ── Tension detection ──
    else if (capacityRate > TENSION_TX_RATE) {
      level = 'tension';
      rec = {
        type: 'open_register',
        reason: `Capacite a ${Math.round(capacityRate * 100)}% — envisager ouverture caisse supplementaire`,
        urgency: 'medium',
        timestamp: now,
      };
    }
    // ── Sous-effectif detection (high revenue target, few cashiers) ──
    else if (revenueRate < SOUS_EFFECTIF_REVENUE_RATIO && activeCashierCount <= 1 && target.revenueTarget > 0) {
      level = 'sous_effectif';
      rec = {
        type: 'open_register',
        reason: `CA a ${Math.round(revenueRate * 100)}% de l'objectif avec ${activeCashierCount} caisse${activeCashierCount > 1 ? 's' : ''}`,
        urgency: 'medium',
        timestamp: now,
      };
    }
    // ── Over-staffing (many cashiers, low capacity) ──
    else if (activeCashierCount > 1 && capacityRate < 0.30 && revenueRate < 0.50) {
      level = 'optimal'; // Don't show red for this
      rec = {
        type: 'close_register',
        reason: `Charge faible (${Math.round(capacityRate * 100)}%) — ${activeCashierCount} caisses ouvertes, 1 suffirait`,
        urgency: 'low',
        timestamp: now,
      };
    }

    // ── Cooldown check — prevent alert fatigue ──
    if (rec.type !== 'none') {
      const lastAlert = s.lastAlertTimestamps[rec.type];
      if (lastAlert) {
        const elapsed = Date.now() - new Date(lastAlert).getTime();
        if (elapsed < ALERT_COOLDOWN_MS) {
          // Same type of alert too recent — suppress
          rec = { ...rec, urgency: 'low' }; // Downgrade urgency
        }
      }
      // Record timestamp
      set((prev) => ({
        lastAlertTimestamps: { ...prev.lastAlertTimestamps, [rec.type]: now },
      }));
    }

    set({
      level,
      lastAnalysisAt: now,
      lastRecommendation: rec,
      analysisCount: s.analysisCount + 1,
    });

    get().persist();

    if (rec.type !== 'none') {
      console.log(`[STAFFING] Analysis #${s.analysisCount + 1}: ${level} — ${rec.reason}`);
    }

    return rec;
  },

  // ── Inactivity check ──
  checkInactivity: () => {
    const now = Date.now();
    const stale: string[] = [];

    get().activeCashiers.forEach((c) => {
      const lastActive = new Date(c.lastActivityAt).getTime();
      if (now - lastActive > INACTIVITY_TIMEOUT_MS) {
        stale.push(c.cashierId);
      }
    });

    if (stale.length > 0) {
      console.log(`[STAFFING] Inactivity detected for ${stale.length} cashier(s): ${stale.join(', ')}`);
      // Emit session closed events
      stale.forEach((cashierId) => {
        const cashier = get().activeCashiers.find((c) => c.cashierId === cashierId);
        if (cashier) {
          posEventBus.emit('SESSION_CLOSED', {
            storeId: '',
            cashierId,
            cashierName: cashier.cashierName,
            timestamp: new Date().toISOString(),
            reason: 'inactivity_timeout',
          });
        }
      });
    }

    return stale;
  },

  // ── Set custom targets ──
  setHourlyTargets: (targets) => {
    set({ hourlyTargets: targets });
    get().persist();
  },

  // ── Computed ──

  getCurrentTarget: () => {
    const hour = new Date().getHours();
    return get().hourlyTargets.find((t) => t.hour === hour) || { hour, revenueTarget: 0, txCapacity: 20 };
  },

  getCapacityRate: () => {
    const s = get();
    const target = s.getCurrentTarget();
    const totalCapacity = target.txCapacity * Math.max(1, s.activeCashiers.length);
    if (totalCapacity === 0) return 0;

    // Extrapolate: how many tx per hour at current rate?
    const now = new Date();
    const minutesIntoHour = now.getMinutes() || 1;
    const projectedTxPerHour = (s.currentHourTx / minutesIntoHour) * 60;
    return Math.min(1, projectedTxPerHour / totalCapacity);
  },

  getRevenueRate: () => {
    const s = get();
    const target = s.getCurrentTarget();
    if (target.revenueTarget === 0) return 1; // No target → always "on track"

    const now = new Date();
    const minutesIntoHour = now.getMinutes() || 1;
    const projectedRevenue = (s.currentHourRevenue / minutesIntoHour) * 60;
    return Math.min(2, projectedRevenue / target.revenueTarget); // cap at 200%
  },

  getAvgSpeedCurrentHour: () => {
    // Average from cashier data
    const cashiers = get().activeCashiers;
    if (cashiers.length === 0) return 0;
    const totalTx = cashiers.reduce((sum, c) => sum + c.txCount, 0);
    if (totalTx === 0) return 0;
    // Rough estimate: total elapsed time / total tx
    const now = Date.now();
    const totalSeconds = cashiers.reduce((sum, c) => {
      const elapsed = (now - new Date(c.sessionOpenedAt).getTime()) / 1000;
      return sum + elapsed;
    }, 0);
    return Math.round(totalSeconds / totalTx);
  },

  getTxPerHourPerCashier: () => {
    const s = get();
    const count = s.activeCashiers.length;
    if (count === 0) return 0;
    const now = new Date();
    const minutesIntoHour = now.getMinutes() || 1;
    return Math.round((s.currentHourTx / count / minutesIntoHour) * 60 * 10) / 10;
  },

  // ── Persistence ──

  persist: () => {
    try {
      const s = get();
      const data = {
        level: s.level,
        lastAnalysisAt: s.lastAnalysisAt,
        lastRecommendation: s.lastRecommendation,
        lastAlertTimestamps: s.lastAlertTimestamps,
        activeCashiers: s.activeCashiers,
        hourlySnapshots: s.hourlySnapshots,
        currentHourTx: s.currentHourTx,
        currentHourRevenue: s.currentHourRevenue,
        currentHourStart: s.currentHourStart,
        lastGlobalActivity: s.lastGlobalActivity,
        analysisCount: s.analysisCount,
      };
      localStorage.setItem(LS_STAFFING, JSON.stringify(data));
    } catch { /* quota */ }
  },

  loadPersistedData: () => {
    try {
      const raw = localStorage.getItem(LS_STAFFING);
      if (!raw) return;
      const data = JSON.parse(raw);
      // Only restore if data is from today
      const todayStr = new Date().toISOString().slice(0, 10);
      if (data.lastAnalysisAt && data.lastAnalysisAt.slice(0, 10) !== todayStr) {
        localStorage.removeItem(LS_STAFFING);
        return;
      }
      set({
        level: data.level || 'unknown',
        lastAnalysisAt: data.lastAnalysisAt,
        lastRecommendation: data.lastRecommendation,
        lastAlertTimestamps: data.lastAlertTimestamps || {},
        activeCashiers: data.activeCashiers || [],
        hourlySnapshots: data.hourlySnapshots || [],
        currentHourTx: data.currentHourTx || 0,
        currentHourRevenue: data.currentHourRevenue || 0,
        currentHourStart: data.currentHourStart ?? new Date().getHours(),
        lastGlobalActivity: data.lastGlobalActivity || new Date().toISOString(),
        analysisCount: data.analysisCount || 0,
      });
      console.log(`[STAFFING] Restored state: ${data.activeCashiers?.length || 0} cashiers, analysis #${data.analysisCount || 0}`);
    } catch { /* corrupted */ }
  },
}));
