// ── SalesCockpit ─────────────────────────────────────────────────
// Real-time shift performance banner: CA vs target, comparisons,
// projection, color-coded alerts, action messages
// ─────────────────────────────────────────────────────────────────

import { useState, useEffect, useMemo, useCallback } from 'react';
import { TrendingUp, TrendingDown, Minus, Target, Clock, Zap, AlertTriangle } from 'lucide-react';
import { usePerformanceStore } from '../stores/performanceStore';

// ── Config (overridable later via store settings) ──
const DEFAULT_SHIFT_TARGET = 200000; // 2000€ in minor units
const SHIFT_DURATION_HOURS = 8;
const GREEN_THRESHOLD = 1.0;   // projection >= 100% target
const ORANGE_THRESHOLD = 0.9;  // projection >= 90% target
const RED_FLASH_THRESHOLD = 0.85; // projection < 85% → flash screen
const FLASH_INTERVAL_MS = 20 * 60 * 1000; // Max 1 flash per 20 minutes
const FLASH_DURATION_MS = 3000; // 3 seconds

// ── Action messages ──
const RED_MESSAGES = [
  'Augmente tes ventes maintenant',
  'Propose une boisson',
  'Travaille le panier moyen',
  'Pousse les ventes additionnelles',
  'Accélère sur les produits d\'impulsion',
];
const ORANGE_MESSAGES = [
  'Attention, rythme à renforcer',
  'Objectif encore jouable',
  'Accélère sur les ventes additionnelles',
  'Propose un 2ème article',
];
const GREEN_MESSAGES = [
  'Bravo, bon rythme !',
  'Continue comme ça',
  'Objectif en ligne',
  'Bien joué',
];

function pickRandom(arr: string[]): string {
  return arr[Math.floor(Math.random() * arr.length)];
}

function formatEuros(minorUnits: number): string {
  return (minorUnits / 100).toLocaleString('fr-FR', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

function formatTime(ms: number): string {
  const totalMin = Math.floor(ms / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h > 0) return `${h}h${m.toString().padStart(2, '0')}`;
  return `${m}min`;
}

type Status = 'green' | 'orange' | 'red';

interface CockpitData {
  currentCA: number;
  target: number;
  percentAchieved: number;
  remaining: number;
  timeElapsedMs: number;
  timeRemainingMs: number;
  requiredPerHour: number;
  projection: number;
  status: Status;
  // Comparisons (placeholders — will be real when backend exposes yesterday/last week)
  vsYesterday: number | null;
  vsLastWeek: number | null;
  actionMessage: string;
}

export function SalesCockpit() {
  const session = usePerformanceStore((s) => s.session);
  const getRevenuePerHour = usePerformanceStore((s) => s.getRevenuePerHour);

  const [now, setNow] = useState(Date.now());
  const [flash, setFlash] = useState<Status | null>(null);
  const [lastFlashAt, setLastFlashAt] = useState(0);

  // Tick every 30s
  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(interval);
  }, []);

  const data: CockpitData | null = useMemo(() => {
    if (!session) return null;

    const target = DEFAULT_SHIFT_TARGET;
    const currentCA = session.totalRevenue;
    const startMs = new Date(session.sessionStartedAt).getTime();
    const elapsedMs = now - startMs;
    const shiftMs = SHIFT_DURATION_HOURS * 3600 * 1000;
    const remainMs = Math.max(0, shiftMs - elapsedMs);
    const elapsedHours = elapsedMs / 3600000;
    const remainHours = remainMs / 3600000;

    const percentAchieved = target > 0 ? currentCA / target : 0;
    const remaining = Math.max(0, target - currentCA);
    const requiredPerHour = remainHours > 0 ? remaining / remainHours : 0;

    // Projection: linear extrapolation
    const ratePerHour = elapsedHours > 0 ? currentCA / elapsedHours : 0;
    const projection = ratePerHour * SHIFT_DURATION_HOURS;
    const projectionRatio = target > 0 ? projection / target : 1;

    // Status
    let status: Status = 'green';
    if (projectionRatio < ORANGE_THRESHOLD) status = 'red';
    else if (projectionRatio < GREEN_THRESHOLD) status = 'orange';

    // Action message
    let actionMessage: string;
    if (status === 'red') actionMessage = pickRandom(RED_MESSAGES);
    else if (status === 'orange') actionMessage = pickRandom(ORANGE_MESSAGES);
    else actionMessage = pickRandom(GREEN_MESSAGES);

    return {
      currentCA,
      target,
      percentAchieved,
      remaining,
      timeElapsedMs: elapsedMs,
      timeRemainingMs: remainMs,
      requiredPerHour,
      projection,
      status,
      vsYesterday: null, // TODO: wire to backend comparison endpoint
      vsLastWeek: null,
      actionMessage,
    };
  }, [session, now]);

  // Flash effect
  useEffect(() => {
    if (!data) return;
    const canFlash = now - lastFlashAt > FLASH_INTERVAL_MS;

    if (data.status === 'red' && data.target > 0) {
      const projRatio = data.projection / data.target;
      if (projRatio < RED_FLASH_THRESHOLD && canFlash) {
        setFlash('red');
        setLastFlashAt(now);
        setTimeout(() => setFlash(null), FLASH_DURATION_MS);
      }
    } else if (data.status === 'green' && data.percentAchieved >= 1 && canFlash) {
      setFlash('green');
      setLastFlashAt(now);
      setTimeout(() => setFlash(null), FLASH_DURATION_MS);
    }
  }, [data?.status, data?.percentAchieved]);

  // Never return null between hooks — render nothing instead
  if (!data || !session) {
    return <></>;
  }

  // Carte SOMBRE (V1 « Cockpit Sombre », design validé) : le statut métier
  // vert/orange/rouge reste porté par l'icône, le badge %, la barre et le
  // message d'action — teintes adaptées au fond anthracite.
  const statusColors = {
    green: { bg: 'bg-emerald-500', text: 'text-emerald-400', msg: 'bg-emerald-500/15 text-emerald-300' },
    orange: { bg: 'bg-amber-500', text: 'text-amber-400', msg: 'bg-amber-500/15 text-amber-300' },
    red: { bg: 'bg-red-500', text: 'text-red-400', msg: 'bg-red-500/15 text-red-300' },
  };
  const colors = statusColors[data.status];
  const pct = Math.min(100, Math.round(data.percentAchieved * 100));

  return (
    <>
      {/* Full-screen flash overlay */}
      {flash && (
        <div
          className={`fixed inset-0 z-[100] flex items-center justify-center pointer-events-none animate-pulse ${
            flash === 'red' ? 'bg-red-500/30' : 'bg-emerald-500/30'
          }`}
          style={{ animation: `pulse 0.8s ease-in-out ${Math.floor(FLASH_DURATION_MS / 800)} alternate` }}
        >
          <div className={`text-center px-12 py-8 rounded-3xl backdrop-blur-md ${
            flash === 'red' ? 'bg-red-600/90 text-white' : 'bg-emerald-600/90 text-white'
          }`}>
            <p className="text-4xl font-black mb-2">
              {flash === 'red' ? '⚠️' : '🎉'}
            </p>
            <p className="text-xl font-bold">{data.actionMessage}</p>
            <p className="text-sm mt-2 opacity-80">
              {formatEuros(data.currentCA)} € / {formatEuros(data.target)} €
            </p>
          </div>
        </div>
      )}

      {/* Main cockpit banner — carte Objectif Shift, fond sombre (V1) */}
      <div className="bg-[#1b1e29] border border-white/10 rounded-2xl p-5 transition-colors duration-500">
        {/* Row 1: Main KPI */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3 min-w-0">
            <div className={`w-11 h-11 rounded-xl ${colors.bg} flex items-center justify-center flex-shrink-0`}>
              <Target size={22} className="text-white" />
            </div>
            <div className="min-w-0">
              <p className="text-[11px] text-slate-400 font-bold uppercase tracking-wider">
                Objectif shift
              </p>
              <div className="flex items-baseline gap-2">
                <span className="text-3xl font-black tabular-nums text-white">
                  {formatEuros(data.currentCA)} €
                </span>
                <span className="text-sm text-slate-500 font-semibold whitespace-nowrap">
                  / {formatEuros(data.target)} €
                </span>
              </div>
            </div>
          </div>

          {/* Percentage badge */}
          <div className={`px-4 py-2.5 rounded-2xl ${colors.bg} text-white flex-shrink-0`}>
            <span className="text-2xl font-black tabular-nums">{pct}%</span>
          </div>
        </div>

        {/* Progress bar */}
        <div className="w-full h-2.5 bg-white/10 rounded-full mb-4 overflow-hidden">
          <div
            className={`h-full ${colors.bg} rounded-full transition-all duration-1000`}
            style={{ width: `${Math.min(100, pct)}%` }}
          />
        </div>

        {/* Row 2: Details — 2×2, plus d'air et de lisibilité */}
        <div className="grid grid-cols-2 gap-2.5 mb-3">
          <div className="p-3 rounded-xl bg-white/[0.06]">
            <p className="text-[10px] text-slate-400 font-bold flex items-center gap-1.5">
              <Zap size={11} /> RESTANT
            </p>
            <p className="text-lg font-black text-white tabular-nums mt-0.5">
              {formatEuros(data.remaining)} €
            </p>
          </div>
          <div className="p-3 rounded-xl bg-white/[0.06]">
            <p className="text-[10px] text-slate-400 font-bold flex items-center gap-1.5">
              <Clock size={11} /> TEMPS RESTANT
            </p>
            <p className="text-lg font-black text-white tabular-nums mt-0.5">
              {formatTime(data.timeRemainingMs)}
            </p>
          </div>
          <div className="p-3 rounded-xl bg-white/[0.06]">
            <p className="text-[10px] text-slate-400 font-bold flex items-center gap-1.5">
              <TrendingUp size={11} /> RYTHME ACTUEL
            </p>
            <p className="text-lg font-black text-white tabular-nums mt-0.5">
              {formatEuros(data.requiredPerHour)} €/h
            </p>
          </div>
          <div className="p-3 rounded-xl bg-white/[0.06]">
            <p className="text-[10px] text-slate-400 font-bold flex items-center gap-1.5">
              <Target size={11} /> CA RÉALISÉ
            </p>
            <p className="text-lg font-black text-white tabular-nums mt-0.5">
              {formatEuros(data.currentCA)} €
            </p>
          </div>
        </div>

        {/* Row 3: Projection */}
        <div className="flex items-center justify-between px-3 py-2 rounded-xl bg-white/[0.06] mb-3">
          <span className="text-xs text-slate-400 font-semibold">Projection fin de shift</span>
          <span className={`text-sm font-bold tabular-nums ${colors.text}`}>
            {formatEuros(data.projection)} €
          </span>
        </div>

        {/* Row 4: Action message */}
        <div className={`flex items-center gap-2 px-3 py-2.5 rounded-xl ${colors.msg}`}>
          {data.status === 'red' ? (
            <AlertTriangle size={14} className="flex-shrink-0" />
          ) : data.status === 'orange' ? (
            <Minus size={14} className="flex-shrink-0" />
          ) : (
            <TrendingUp size={14} className="flex-shrink-0" />
          )}
          <p className="text-xs font-bold">
            {data.actionMessage}
          </p>
        </div>
      </div>
    </>
  );
}
