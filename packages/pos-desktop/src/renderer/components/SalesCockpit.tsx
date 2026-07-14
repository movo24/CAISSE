// ── SalesCockpit ─────────────────────────────────────────────────
// Real-time shift performance banner: CA vs target, projection,
// color-coded alerts, action messages.
//
// RÈGLE DONNÉES (owner, validée) : toutes les valeurs affichées
// proviennent des VRAIES données de la caisse (performanceStore).
// Aucun chiffre fictif, aucun exemple codé en dur. Quand une donnée
// réelle n'existe pas encore (objectif ou durée de shift non
// configurés), l'état neutre « — » est affiché et les indicateurs
// dérivés (%, statut, projection, message d'action) sont neutralisés.
// ─────────────────────────────────────────────────────────────────

import { useState, useEffect, useMemo } from 'react';
import { TrendingUp, Minus, Target, Clock, Zap, AlertTriangle, Receipt } from 'lucide-react';
import { usePerformanceStore } from '../stores/performanceStore';

// ── Configuration réelle (aucune valeur par défaut inventée) ──
// L'objectif et la durée du shift ne sont affichés QUE s'ils ont été
// réellement configurés sur ce poste (par un manager / la config
// magasin). Sinon → état neutre « — ».
//   caisse_shift_target_minor : objectif de CA du shift, en centimes
//   caisse_shift_duration_min : durée du shift, en minutes
const LS_SHIFT_TARGET = 'caisse_shift_target_minor';
const LS_SHIFT_DURATION = 'caisse_shift_duration_min';

const GREEN_THRESHOLD = 1.0;   // projection >= 100% target
const ORANGE_THRESHOLD = 0.9;  // projection >= 90% target
const RED_FLASH_THRESHOLD = 0.85; // projection < 85% → flash screen
const FLASH_INTERVAL_MS = 20 * 60 * 1000; // Max 1 flash per 20 minutes
const FLASH_DURATION_MS = 3000; // 3 seconds

// ── Action messages (affichés uniquement quand le statut est calculé
//    à partir d'un objectif RÉEL — jamais sur données absentes) ──
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

/** Lit une valeur numérique réellement configurée ; null sinon (jamais de défaut inventé). */
function readConfiguredPositiveInt(key: string): number | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
  } catch {
    return null;
  }
}

type Status = 'green' | 'orange' | 'red';

interface CockpitData {
  // Toujours réels (performanceStore)
  currentCA: number;
  ticketCount: number;
  itemCount: number;
  ratePerHour: number;          // rythme RÉEL constaté (CA / temps écoulé)
  // Réels uniquement si configurés — sinon null → « — »
  target: number | null;
  percentAchieved: number | null;
  remaining: number | null;
  timeRemainingMs: number | null;
  projection: number | null;
  status: Status | null;
  actionMessage: string | null;
}

export function SalesCockpit() {
  const session = usePerformanceStore((s) => s.session);

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

    // ── Données réelles de session ──
    const currentCA = session.totalRevenue;
    const startMs = new Date(session.sessionStartedAt).getTime();
    const elapsedMs = Math.max(0, now - startMs);
    const elapsedHours = elapsedMs / 3600000;
    const ratePerHour = elapsedHours > 0 ? Math.round(currentCA / elapsedHours) : 0;

    // ── Objectif / durée : uniquement si réellement configurés ──
    const target = readConfiguredPositiveInt(LS_SHIFT_TARGET);
    const durationMin = readConfiguredPositiveInt(LS_SHIFT_DURATION);

    const percentAchieved = target !== null ? currentCA / target : null;
    const remaining = target !== null ? Math.max(0, target - currentCA) : null;

    let timeRemainingMs: number | null = null;
    let projection: number | null = null;
    if (durationMin !== null) {
      const shiftMs = durationMin * 60 * 1000;
      timeRemainingMs = Math.max(0, shiftMs - elapsedMs);
      projection = Math.round(ratePerHour * (durationMin / 60));
    }

    // ── Statut : calculable seulement avec objectif ET durée réels ──
    let status: Status | null = null;
    let actionMessage: string | null = null;
    if (target !== null && projection !== null) {
      const projectionRatio = projection / target;
      status = 'green';
      if (projectionRatio < ORANGE_THRESHOLD) status = 'red';
      else if (projectionRatio < GREEN_THRESHOLD) status = 'orange';
      if (status === 'red') actionMessage = pickRandom(RED_MESSAGES);
      else if (status === 'orange') actionMessage = pickRandom(ORANGE_MESSAGES);
      else actionMessage = pickRandom(GREEN_MESSAGES);
    }

    return {
      currentCA,
      ticketCount: session.ticketCount,
      itemCount: session.itemCount,
      ratePerHour,
      target,
      percentAchieved,
      remaining,
      timeRemainingMs,
      projection,
      status,
      actionMessage,
    };
  }, [session, now]);

  // Flash effect — uniquement quand le statut repose sur un objectif réel
  useEffect(() => {
    if (!data || data.status === null || data.target === null || data.projection === null) return;
    const canFlash = now - lastFlashAt > FLASH_INTERVAL_MS;

    if (data.status === 'red') {
      const projRatio = data.projection / data.target;
      if (projRatio < RED_FLASH_THRESHOLD && canFlash) {
        setFlash('red');
        setLastFlashAt(now);
        setTimeout(() => setFlash(null), FLASH_DURATION_MS);
      }
    } else if (data.status === 'green' && (data.percentAchieved ?? 0) >= 1 && canFlash) {
      setFlash('green');
      setLastFlashAt(now);
      setTimeout(() => setFlash(null), FLASH_DURATION_MS);
    }
  }, [data?.status, data?.percentAchieved]);

  // Never return null between hooks — render nothing instead
  if (!data || !session) {
    return <></>;
  }

  // Carte CLAIRE (refonte premium) : le statut métier vert/orange/rouge reste
  // porté par l'icône, le badge %, la barre et le message d'action. Sans
  // objectif réel configuré, le statut est NEUTRE (gris) — jamais simulé.
  const statusColors = {
    green: { bg: 'bg-emerald-500', text: 'text-emerald-600', msg: 'bg-emerald-50 text-emerald-700' },
    orange: { bg: 'bg-amber-500', text: 'text-amber-600', msg: 'bg-amber-50 text-amber-700' },
    red: { bg: 'bg-red-500', text: 'text-red-600', msg: 'bg-red-50 text-red-700' },
  };
  const neutralColors = { bg: 'bg-pos-subtle', text: 'text-pos-muted', msg: 'bg-pos-subtle text-pos-muted' };
  const colors = data.status !== null ? statusColors[data.status] : neutralColors;
  const pct = data.percentAchieved !== null ? Math.min(100, Math.round(data.percentAchieved * 100)) : null;

  return (
    <>
      {/* Full-screen flash overlay */}
      {flash && data.target !== null && (
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
      <div className="bg-white border border-pos-border rounded-2xl p-5 transition-colors duration-500">
        {/* Row 1: Main KPI — CA réel de la session / objectif réel ou « — » */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3 min-w-0">
            <div className={`w-11 h-11 rounded-xl ${colors.bg} flex items-center justify-center flex-shrink-0`}>
              <Target size={22} className={data.status !== null ? 'text-white' : 'text-pos-muted'} />
            </div>
            <div className="min-w-0">
              <p className="text-[11px] text-pos-muted font-bold uppercase tracking-wider">
                Objectif shift
              </p>
              <div className="flex items-baseline gap-2">
                <span className="text-3xl font-black tabular-nums text-pos-text">
                  {formatEuros(data.currentCA)} €
                </span>
                <span className="text-sm text-pos-muted/80 font-semibold whitespace-nowrap">
                  / {data.target !== null ? `${formatEuros(data.target)} €` : '—'}
                </span>
              </div>
            </div>
          </div>

          {/* Percentage badge — % réel ou neutre */}
          <div className={`px-4 py-2.5 rounded-2xl ${colors.bg} ${data.status !== null ? 'text-white' : 'text-pos-muted'} flex-shrink-0`}>
            <span className="text-2xl font-black tabular-nums">{pct !== null ? `${pct}%` : '—'}</span>
          </div>
        </div>

        {/* Progress bar — progression réelle ; vide sans objectif configuré */}
        <div className="w-full h-2.5 bg-pos-subtle rounded-full mb-4 overflow-hidden">
          <div
            className={`h-full ${data.status !== null ? colors.bg : 'bg-pos-border'} rounded-full transition-all duration-1000`}
            style={{ width: `${pct !== null ? Math.min(100, pct) : 0}%` }}
          />
        </div>

        {/* Row 2: Details — 2×2, valeurs réelles uniquement (« — » sinon) */}
        <div className="grid grid-cols-2 gap-2.5 mb-3">
          <div className="p-3 rounded-xl bg-pos-subtle/70">
            <p className="text-[10px] text-pos-muted font-bold flex items-center gap-1.5">
              <Zap size={11} /> RESTANT
            </p>
            <p className="text-lg font-black text-pos-text tabular-nums mt-0.5">
              {data.remaining !== null ? `${formatEuros(data.remaining)} €` : '—'}
            </p>
          </div>
          <div className="p-3 rounded-xl bg-pos-subtle/70">
            <p className="text-[10px] text-pos-muted font-bold flex items-center gap-1.5">
              <Clock size={11} /> TEMPS RESTANT
            </p>
            <p className="text-lg font-black text-pos-text tabular-nums mt-0.5">
              {data.timeRemainingMs !== null ? formatTime(data.timeRemainingMs) : '—'}
            </p>
          </div>
          <div className="p-3 rounded-xl bg-pos-subtle/70">
            <p className="text-[10px] text-pos-muted font-bold flex items-center gap-1.5">
              <TrendingUp size={11} /> RYTHME ACTUEL
            </p>
            <p className="text-lg font-black text-pos-text tabular-nums mt-0.5">
              {formatEuros(data.ratePerHour)} €/h
            </p>
          </div>
          <div className="p-3 rounded-xl bg-pos-subtle/70">
            <p className="text-[10px] text-pos-muted font-bold flex items-center gap-1.5">
              <Receipt size={11} /> TICKETS · ARTICLES
            </p>
            <p className="text-lg font-black text-pos-text tabular-nums mt-0.5">
              {data.ticketCount} · {data.itemCount}
            </p>
          </div>
        </div>

        {/* Row 3: Projection — réelle (rythme × durée configurée) ou « — » */}
        <div className="flex items-center justify-between px-3 py-2 rounded-xl bg-pos-subtle/70 mb-3">
          <span className="text-xs text-pos-muted font-semibold">Projection fin de shift</span>
          <span className={`text-sm font-bold tabular-nums ${colors.text}`}>
            {data.projection !== null ? `${formatEuros(data.projection)} €` : '—'}
          </span>
        </div>

        {/* Row 4: Action message — uniquement sur statut calculé (objectif réel) */}
        {data.status !== null && data.actionMessage !== null && (
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
        )}
      </div>
    </>
  );
}
