import { useEffect, useState, useCallback } from 'react';
import { AlertTriangle } from 'lucide-react';
import { usePOSStore } from '../stores/posStore';
import { employeeScoreApi, posTerminalId } from '../services/api';

/**
 * Bloc identité caisse — hiérarchisé (refonte premium).
 *
 * Règle métier : une caisse appartient clairement à un caissier à un instant T.
 * Hiérarchie : OPÉRATEUR (dominant) → caisse · magasin · n° session (secondaire)
 * → score jour (pastille sobre, cliquable).
 *
 * Si aucune session employé n'est ouverte :
 *   AUCUN CAISSIER CONNECTÉ — Connexion obligatoire pour encaisser
 */

type ScoreColor = 'green' | 'orange' | 'red' | 'red_critical';

function scoreDot(color?: ScoreColor): string {
  switch (color) {
    case 'green': return 'bg-emerald-500';
    case 'orange': return 'bg-amber-500';
    case 'red': return 'bg-red-500';
    case 'red_critical': return 'bg-red-600';
    default: return 'bg-gray-300';
  }
}
function terminalDisplay(): string {
  // "TERMINAL 02" → "Caisse 02"
  return posTerminalId().replace(/^TERMINAL/i, 'Caisse').trim();
}
function hhmm(iso?: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

interface DayScore { total: number; color: ScoreColor }
interface ScoreSummary { day: DayScore; week: DayScore; year: DayScore }

/**
 * @param compact — conservé pour compat (densité gérée par le header premium).
 * @param onScoreClick — ouvre le détail du score.
 */
export function ActiveCashierBanner({
  compact = false,
  onScoreClick,
}: {
  compact?: boolean;
  onScoreClick?: () => void;
}) {
  const employee = usePOSStore((s) => s.employee);
  const posSession = usePOSStore((s) => s.posSession);
  const sessionOpenFailed = usePOSStore((s) => s.posSessionOpenFailed);
  const storeInfo = usePOSStore((s) => s.storeInfo);
  const [score, setScore] = useState<ScoreSummary | null>(null);

  const refreshScore = useCallback(async () => {
    if (!employee) { setScore(null); return; }
    try {
      const res = await employeeScoreApi.me();
      setScore(res.data);
    } catch {
      setScore(null); // score indisponible → on n'invente pas
    }
  }, [employee]);

  useEffect(() => {
    refreshScore();
    const t = setInterval(refreshScore, 60_000);
    return () => clearInterval(t);
  }, [refreshScore]);

  // ── AUCUN CAISSIER CONNECTÉ ──
  if (!employee) {
    return (
      <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-red-50 ring-1 ring-red-200">
        <AlertTriangle size={compact ? 16 : 18} className="text-red-600 shrink-0" />
        <div className="leading-tight">
          <p className={`font-black text-red-700 ${compact ? 'text-sm' : 'text-base'}`}>AUCUN CAISSIER CONNECTÉ</p>
          <p className="text-[10px] text-red-500 font-medium">Connexion obligatoire pour encaisser</p>
        </div>
      </div>
    );
  }

  const name = `${employee.firstName} ${employee.lastName}`.trim();
  const day = score?.day;
  const sessionNo = posSession?.id ? `#${posSession.id.slice(0, 8).toUpperCase()}` : null;
  const storeName = storeInfo?.storeName || null;

  return (
    <div className="flex items-center gap-3 min-w-0">
      <div className="leading-tight min-w-0">
        {/* Opérateur — niveau 1 */}
        <p className="text-sm font-bold text-pos-text truncate">{name}</p>
        {/* Caisse · magasin · session — niveau 2, une seule ligne calme */}
        <p className="text-[11px] text-pos-muted truncate tabular-nums">
          {terminalDisplay()}
          {storeName && <> · {storeName}</>}
          {sessionNo && <> · Session {sessionNo}</>}
          {posSession?.openedAt && <> · depuis {hhmm(posSession.openedAt)}</>}
          {!posSession && sessionOpenFailed && (
            <span
              className="ml-1 inline-flex items-center rounded px-1.5 py-0.5 bg-red-100 text-red-700 font-bold uppercase tracking-wide"
              title="La session de caisse n'a pas pu être ouverte sur le serveur : les ventes passent mais ne seront rattachées à aucun comptage de caisse. Reconnectez-vous quand le serveur répond."
            >
              Session non ouverte
            </span>
          )}
        </p>
      </div>
      {/* Score jour — pastille sobre */}
      <button
        onClick={onScoreClick}
        title="Voir le détail du score"
        className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-pos-border bg-white text-xs font-semibold text-pos-text/80 hover:bg-pos-subtle shrink-0 transition-colors active:scale-95"
      >
        <span className={`w-2 h-2 rounded-full ${scoreDot(day?.color)}`} />
        <span className="text-pos-muted font-medium">Score</span>
        <span className="tabular-nums">{day ? day.total : '—'}</span>
      </button>
    </div>
  );
}
