import { useState, useEffect, useCallback } from 'react';
import { Users, Loader2, AlertTriangle, RefreshCw, UserCircle, Activity } from 'lucide-react';
import { employeeScoreApi } from '../services/api';

interface TeamRow {
  employeeId: string;
  employeeName: string | null;
  day: { total: number; color: string };
  week: { total: number; color: string };
  eventCount: number;
  lastActivity: string | null;
}

/** Colour classes per score band (mirrors backend scoreColor). */
const COLOR_STYLE: Record<string, string> = {
  green: 'bg-emerald-100 text-emerald-700',
  orange: 'bg-amber-100 text-amber-700',
  red: 'bg-orange-100 text-orange-700',
  red_critical: 'bg-red-100 text-red-700',
};

function ScoreBadge({ total, color }: { total: number; color: string }) {
  return (
    <span className={`inline-flex min-w-[3rem] justify-center rounded-full px-2.5 py-1 text-sm font-semibold ${COLOR_STYLE[color] || COLOR_STYLE.green}`}>
      {total}
    </span>
  );
}

function dt(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

export function EmployeeScoresPage() {
  const [team, setTeam] = useState<TeamRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sinceDays, setSinceDays] = useState(7);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await employeeScoreApi.team(sinceDays);
      setTeam(Array.isArray(res.data) ? res.data : []);
    } catch (e: any) {
      setError(e?.response?.data?.message || 'Chargement impossible. Réservé aux managers/admins.');
    } finally {
      setLoading(false);
    }
  }, [sinceDays]);

  useEffect(() => { load(); }, [load]);

  const attention = team.filter((t) => t.day.color === 'red' || t.day.color === 'red_critical').length;

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Users className="text-indigo-600" size={26} />
          <div>
            <h1 className="text-xl font-semibold text-gray-900">Scores équipe</h1>
            <p className="text-sm text-gray-500">
              Score 100 % factuel, dérivé des faits POS probants (session, caisse, procédures). Jamais subjectif. Les cas à regarder d&apos;abord sont en haut.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={sinceDays}
            onChange={(e) => setSinceDays(Number(e.target.value))}
            className="rounded-lg border border-gray-200 px-2 py-2 text-sm text-gray-600"
          >
            <option value={7}>7 jours</option>
            <option value={30}>30 jours</option>
            <option value={90}>90 jours</option>
          </select>
          <button
            onClick={load}
            className="flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-600 hover:bg-gray-50"
          >
            <RefreshCw size={15} /> Rafraîchir
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
        <div className="rounded-xl border border-gray-100 bg-white p-4">
          <p className="text-xs uppercase tracking-wide text-gray-400">Employés actifs (fenêtre)</p>
          <p className="text-2xl font-semibold text-gray-900">{team.length}</p>
        </div>
        <div className="rounded-xl border border-gray-100 bg-white p-4">
          <p className="text-xs uppercase tracking-wide text-gray-400">À surveiller (score rouge)</p>
          <p className="text-2xl font-semibold text-gray-900">{attention}</p>
        </div>
      </div>

      {error && (
        <div className="mb-4 flex items-center gap-2 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
          <AlertTriangle size={16} /> {error}
        </div>
      )}

      <div className="overflow-x-auto rounded-xl border border-gray-100 bg-white">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 text-left text-xs uppercase tracking-wide text-gray-400">
              <th className="px-4 py-2">Employé</th>
              <th className="px-4 py-2 text-center">Score jour</th>
              <th className="px-4 py-2 text-center">Score semaine</th>
              <th className="px-4 py-2 text-right">Événements</th>
              <th className="px-4 py-2 text-right">Dernière activité</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-400"><Loader2 className="inline animate-spin" size={18} /></td></tr>
            ) : team.length === 0 ? (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-400">Aucune activité de score sur la période.</td></tr>
            ) : (
              team.map((t) => (
                <tr key={t.employeeId} className="border-b border-gray-50 last:border-0">
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-2">
                      <UserCircle size={18} className="text-gray-400" />
                      <span className="font-medium text-gray-800">{t.employeeName || t.employeeId.slice(0, 8)}</span>
                    </div>
                  </td>
                  <td className="px-4 py-2.5 text-center"><ScoreBadge total={t.day.total} color={t.day.color} /></td>
                  <td className="px-4 py-2.5 text-center"><ScoreBadge total={t.week.total} color={t.week.color} /></td>
                  <td className="px-4 py-2.5 text-right text-gray-600">
                    <span className="inline-flex items-center gap-1"><Activity size={13} className="text-gray-400" /> {t.eventCount}</span>
                  </td>
                  <td className="px-4 py-2.5 text-right text-gray-500">{dt(t.lastActivity)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <p className="mt-3 text-[11px] text-gray-400">
        Le score part de 100 et ne fait que retrancher sur des faits vérifiables (écart caisse, procédure non respectée, session). Une action légitime ne pénalise jamais.
      </p>
    </div>
  );
}
