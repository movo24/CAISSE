import { useEffect, useState, useCallback } from 'react';
import { AlertTriangle, Clock, Monitor } from 'lucide-react';
import { usePOSStore } from '../stores/posStore';
import { employeeScoreApi, posTerminalId } from '../services/api';

/**
 * Bloc caissier actif — VISIBLE EN PERMANENCE, impossible à rater.
 *
 * Règle métier : une caisse appartient clairement à un caissier à un instant T.
 *   CAISSE DE : KARIM B.
 *   Session ouverte depuis 09:04 · Terminal : Caisse 02 · Score jour : 86 🟢
 *
 * Si aucune session employé n'est ouverte :
 *   AUCUN CAISSIER CONNECTÉ — Connexion obligatoire pour encaisser
 */

type ScoreColor = 'green' | 'orange' | 'red' | 'red_critical';

function colorClasses(color?: ScoreColor): string {
  switch (color) {
    case 'green': return 'bg-emerald-100 text-emerald-700';
    case 'orange': return 'bg-amber-100 text-amber-700';
    case 'red': return 'bg-red-100 text-red-700';
    case 'red_critical': return 'bg-red-200 text-red-800';
    default: return 'bg-gray-100 text-gray-500';
  }
}
function colorEmoji(color?: ScoreColor): string {
  if (color === 'green') return '🟢';
  if (color === 'orange') return '🟠';
  return color ? '🔴' : '⚪';
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
 * @param compact — variante réduite (barres denses iPad) ; le nom reste dominant.
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

  return (
    <div className={`flex items-center gap-3 rounded-xl bg-white ring-1 ring-pos-border/40 shadow-sm ${compact ? 'px-3 py-1' : 'px-4 py-2'}`}>
      {/* Pictogramme avatar retiré (demande owner : aucune information utile) */}
      <div className="leading-tight min-w-0">
        <p className={`font-black text-pos-text uppercase tracking-wide truncate ${compact ? 'text-sm' : 'text-lg'}`}>
          <span className="text-pos-muted font-semibold">Caisse de : </span>{name}
        </p>
        <div className={`flex items-center gap-2 text-pos-muted ${compact ? 'text-[10px]' : 'text-xs'}`}>
          <span className="inline-flex items-center gap-1"><Clock size={11} /> Session depuis {hhmm(posSession?.openedAt)}</span>
          <span className="text-pos-border">·</span>
          <span className="inline-flex items-center gap-1"><Monitor size={11} /> {terminalDisplay()}</span>
        </div>
      </div>
      <button
        onClick={onScoreClick}
        title="Voir le détail du score"
        className={`ml-auto flex items-center gap-1.5 rounded-lg font-bold shrink-0 transition-transform active:scale-95 ${colorClasses(day?.color)} ${compact ? 'px-2 py-1 text-xs' : 'px-3 py-1.5 text-sm'}`}
      >
        <span className="opacity-70 font-medium">Score jour</span>
        <span>{day ? day.total : '—'}</span>
        <span>{colorEmoji(day?.color)}</span>
      </button>
    </div>
  );
}
