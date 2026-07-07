import { useState, useEffect, useCallback } from 'react';
import {
  Wallet, Loader2, AlertTriangle, RefreshCw, Monitor, UserCircle,
  CircleDot, Bell, CheckCircle2,
} from 'lucide-react';
import { posSessionsApi, employeeScoreApi } from '../services/api';

interface Session {
  id: string;
  employeeId: string;
  employeeName: string;
  employeeRole: string;
  terminalId: string | null;
  isActive: boolean;
  openedAt: string;
  closedAt: string | null;
  openingCashMinorUnits: number | null;
  cashSalesMinorUnits: number | null;
  expectedCashMinorUnits: number | null;
  countedCashMinorUnits: number | null;
  cashDifferenceMinorUnits: number | null;
  cashCountedAt: string | null;
}

interface ScoreAlert {
  id: string;
  employeeId: string;
  eventType: string;
  category: string;
  severity: string;
  pointsDelta: number;
  reason: string | null;
  terminalId: string | null;
  sessionId: string | null;
  createdAt: string;
}

/** centimes → « 12,34 € » (or « — » when null). */
function euros(minor: number | null | undefined): string {
  if (minor == null) return '—';
  return `${(minor / 100).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
}

function dt(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

/** Colour band for a cash difference (centimes). Mirrors the score severities. */
function diffClass(diff: number | null): string {
  if (diff == null) return 'text-gray-400';
  const abs = Math.abs(diff);
  if (abs === 0) return 'text-emerald-600';
  if (abs < 500) return 'text-amber-600';
  if (abs < 2000) return 'text-orange-600';
  return 'text-red-600 font-semibold';
}

const SEVERITY_STYLE: Record<string, string> = {
  info: 'bg-gray-100 text-gray-600',
  minor: 'bg-amber-100 text-amber-700',
  major: 'bg-orange-100 text-orange-700',
  critical: 'bg-red-100 text-red-700',
};

export function CashSessionsPage() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [alerts, setAlerts] = useState<ScoreAlert[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [withCashOnly, setWithCashOnly] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [sRes, aRes] = await Promise.all([
        posSessionsApi.list({ limit: 100, withCashCountOnly: withCashOnly }),
        employeeScoreApi.alerts(72),
      ]);
      setSessions(Array.isArray(sRes.data) ? sRes.data : []);
      setAlerts(Array.isArray(aRes.data) ? aRes.data : []);
    } catch (e: any) {
      setError(e?.response?.data?.message || 'Chargement impossible. Réservé aux managers/admins.');
    } finally {
      setLoading(false);
    }
  }, [withCashOnly]);

  useEffect(() => { load(); }, [load]);

  const counted = sessions.filter((s) => s.cashCountedAt);
  const totalEcart = counted.reduce((sum, s) => sum + (s.cashDifferenceMinorUnits ?? 0), 0);
  const materialEcarts = counted.filter((s) => Math.abs(s.cashDifferenceMinorUnits ?? 0) >= 500).length;

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Wallet className="text-indigo-600" size={26} />
          <div>
            <h1 className="text-xl font-semibold text-gray-900">Sessions caisse & écarts</h1>
            <p className="text-sm text-gray-500">
              Attendu calculé côté serveur (fond + ventes espèces de la session) vs compté réel. Donnée probante, rattachée à une vraie session.
            </p>
          </div>
        </div>
        <button
          onClick={load}
          className="flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-600 hover:bg-gray-50"
        >
          <RefreshCw size={15} /> Rafraîchir
        </button>
      </div>

      {/* KPI band */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <div className="rounded-xl border border-gray-100 bg-white p-4">
          <p className="text-xs uppercase tracking-wide text-gray-400">Sessions comptées</p>
          <p className="text-2xl font-semibold text-gray-900">{counted.length}</p>
        </div>
        <div className="rounded-xl border border-gray-100 bg-white p-4">
          <p className="text-xs uppercase tracking-wide text-gray-400">Écart cumulé</p>
          <p className={`text-2xl font-semibold ${diffClass(totalEcart)}`}>{euros(totalEcart)}</p>
        </div>
        <div className="rounded-xl border border-gray-100 bg-white p-4">
          <p className="text-xs uppercase tracking-wide text-gray-400">Écarts matériels (≥ 5 €)</p>
          <p className="text-2xl font-semibold text-gray-900">{materialEcarts}</p>
        </div>
      </div>

      {error && (
        <div className="mb-4 flex items-center gap-2 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
          <AlertTriangle size={16} /> {error}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Sessions table */}
        <div className="lg:col-span-2">
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-sm font-semibold text-gray-700">Sessions récentes</h2>
            <label className="flex items-center gap-2 text-xs text-gray-500">
              <input type="checkbox" checked={withCashOnly} onChange={(e) => setWithCashOnly(e.target.checked)} />
              Comptées uniquement
            </label>
          </div>
          <div className="overflow-x-auto rounded-xl border border-gray-100 bg-white">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 text-left text-xs uppercase tracking-wide text-gray-400">
                  <th className="px-3 py-2">Caissier</th>
                  <th className="px-3 py-2">Terminal</th>
                  <th className="px-3 py-2">Ouverte</th>
                  <th className="px-3 py-2">Fermée</th>
                  <th className="px-3 py-2 text-right">Attendu</th>
                  <th className="px-3 py-2 text-right">Compté</th>
                  <th className="px-3 py-2 text-right">Écart</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={7} className="px-3 py-8 text-center text-gray-400"><Loader2 className="inline animate-spin" size={18} /></td></tr>
                ) : sessions.length === 0 ? (
                  <tr><td colSpan={7} className="px-3 py-8 text-center text-gray-400">Aucune session.</td></tr>
                ) : (
                  sessions.map((s) => (
                    <tr key={s.id} className="border-b border-gray-50 last:border-0">
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-1.5">
                          <UserCircle size={15} className="text-gray-400" />
                          <span className="text-gray-800">{s.employeeName || s.employeeId.slice(0, 8)}</span>
                        </div>
                      </td>
                      <td className="px-3 py-2">
                        <span className="inline-flex items-center gap-1 text-gray-600">
                          <Monitor size={13} className="text-gray-400" /> {s.terminalId || '—'}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-gray-500">{dt(s.openedAt)}</td>
                      <td className="px-3 py-2">
                        {s.isActive ? (
                          <span className="inline-flex items-center gap-1 text-emerald-600"><CircleDot size={12} /> active</span>
                        ) : (
                          <span className="text-gray-500">{dt(s.closedAt)}</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right text-gray-700">{euros(s.expectedCashMinorUnits)}</td>
                      <td className="px-3 py-2 text-right text-gray-700">{euros(s.countedCashMinorUnits)}</td>
                      <td className={`px-3 py-2 text-right ${diffClass(s.cashDifferenceMinorUnits)}`}>
                        {s.cashCountedAt ? euros(s.cashDifferenceMinorUnits) : '—'}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Score alerts feed */}
        <div>
          <h2 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-gray-700">
            <Bell size={15} className="text-indigo-500" /> Alertes score (72 h)
          </h2>
          <div className="rounded-xl border border-gray-100 bg-white divide-y divide-gray-50 max-h-[520px] overflow-y-auto">
            {loading ? (
              <div className="px-4 py-8 text-center text-gray-400"><Loader2 className="inline animate-spin" size={18} /></div>
            ) : alerts.length === 0 ? (
              <div className="px-4 py-8 text-center text-gray-400">
                <CheckCircle2 className="inline mb-1 text-emerald-400" size={20} />
                <p className="text-sm">Aucune alerte récente.</p>
              </div>
            ) : (
              alerts.map((a) => (
                <div key={a.id} className="px-4 py-3">
                  <div className="flex items-center justify-between">
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${SEVERITY_STYLE[a.severity] || SEVERITY_STYLE.info}`}>
                      {a.eventType}
                    </span>
                    <span className="text-[11px] text-gray-400">{dt(a.createdAt)}</span>
                  </div>
                  {a.reason && <p className="mt-1 text-xs text-gray-600">{a.reason}</p>}
                  <p className="mt-1 text-[11px] text-gray-400">
                    {a.terminalId ? `Terminal ${a.terminalId} · ` : ''}
                    {a.pointsDelta !== 0 ? `${a.pointsDelta} pts` : 'signalé'}
                  </p>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
