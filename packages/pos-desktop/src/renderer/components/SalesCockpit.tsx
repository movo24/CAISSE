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

  const statusColors = {
    green: { bg: 'bg-emerald-500', text: 'text-emerald-600', light: 'bg-emerald-50', border: 'border-emerald-200' },
    orange: { bg: 'bg-amber-500', text: 'text-amber-600', light: 'bg-amber-50', border: 'border-amber-200' },
    red: { bg: 'bg-red-500', text: 'text-red-600', light: 'bg-red-50', border: 'border-red-200' },
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

      {/* Main cockpit banner */}
      <div className={`${colors.light} ${colors.border} border rounded-2xl p-4 mb-4 transition-colors duration-500`}>
        {/* Row 1: Main KPI */}
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded-xl ${colors.bg} flex items-center justify-center`}>
              <Target size={20} className="text-white" />
            </div>
            <div>
              <p className="text-[10px] text-gray-500 font-semibold uppercase tracking-wide">
                Objectif shift
              </p>
              <div className="flex items-baseline gap-2">
                <span className={`text-2xl font-black tabular-nums ${colors.text}`}>
                  {formatEuros(data.currentCA)} €
                </span>
                <span className="text-sm text-gray-400 font-semibold">
                  / {formatEuros(data.target)} €
                </span>
              </div>
            </div>
          </div>

          {/* Percentage badge */}
          <div className={`px-4 py-2 rounded-xl ${colors.bg} text-white`}>
            <span className="text-xl font-black tabular-nums">{pct}%</span>
          </div>
        </div>

        {/* Progress bar */}
        <div className="w-full h-2 bg-gray-200 rounded-full mb-3 overflow-hidden">
          <div
            className={`h-full ${colors.bg} rounded-full transition-all duration-1000`}
            style={{ width: `${Math.min(100, pct)}%` }}
          />
        </div>

        {/* Row 2: Details */}
        <div className="grid grid-cols-3 gap-2 mb-3">
          <div className="text-center p-2 rounded-xl bg-white/60">
            <p className="text-[9px] text-gray-500 font-semibold flex items-center justify-center gap-1">
              <Zap size={9} /> RESTANT
            </p>
            <p className="text-sm font-bold text-gray-700 tabular-nums">
              {formatEuros(data.remaining)} €
            </p>
          </div>
          <div className="text-center p-2 rounded-xl bg-white/60">
            <p className="text-[9px] text-gray-500 font-semibold flex items-center justify-center gap-1">
              <Clock size={9} /> TEMPS
            </p>
            <p className="text-sm font-bold text-gray-700 tabular-nums">
              {formatTime(data.timeRemainingMs)}
            </p>
          </div>
          <div className="text-center p-2 rounded-xl bg-white/60">
            <p className="text-[9px] text-gray-500 font-semibold flex items-center justify-center gap-1">
              <TrendingUp size={9} /> RYTHME
            </p>
            <p className="text-sm font-bold text-gray-700 tabular-nums">
              {formatEuros(data.requiredPerHour)} €/h
            </p>
          </div>
        </div>

        {/* Row 3: Projection */}
        <div className="flex items-center justify-between px-3 py-2 rounded-xl bg-white/60 mb-3">
          <span className="text-xs text-gray-500 font-semibold">Projection fin de shift</span>
          <span className={`text-sm font-bold tabular-nums ${colors.text}`}>
            {formatEuros(data.projection)} €
          </span>
        </div>

        {/* Row 4: Action message */}
        <div className={`flex items-center gap-2 px-3 py-2.5 rounded-xl ${
          data.status === 'red' ? 'bg-red-100' : data.status === 'orange' ? 'bg-amber-100' : 'bg-emerald-100'
        }`}>
          {data.status === 'red' ? (
            <AlertTriangle size={14} className="text-red-600 flex-shrink-0" />
          ) : data.status === 'orange' ? (
            <Minus size={14} className="text-amber-600 flex-shrink-0" />
          ) : (
            <TrendingUp size={14} className="text-emerald-600 flex-shrink-0" />
          )}
          <p className={`text-xs font-bold ${colors.text}`}>
            {data.actionMessage}
          </p>
        </div>
      </div>
    </>
  );
}
