import React, { useCallback, useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { ShieldCheck, ShieldAlert, Users, LogIn, Activity, ScrollText, ChevronLeft, ChevronRight, RefreshCw } from 'lucide-react';
import { useAuthStore } from '../stores/authStore';
import { securityApi, activityApi, employeesApi } from '../services/api';
import { trackView } from '../services/telemetry';

type Tab = 'users' | 'logins' | 'activity' | 'rights';

const TABS: { key: Tab; label: string; icon: React.ComponentType<any> }[] = [
  { key: 'users', label: 'Utilisateurs', icon: Users },
  { key: 'logins', label: 'Connexions', icon: LogIn },
  { key: 'activity', label: 'Activité', icon: Activity },
  { key: 'rights', label: 'Audit des droits', icon: ScrollText },
];

const APPLICATION_ROLES = [
  'STORE_MANAGER', 'ASSISTANT_MANAGER', 'MULTI_STORE_MANAGER', 'REGIONAL_MANAGER',
  'CENTRAL_DIRECTOR', 'CENTRAL_ADMIN', 'TECHNICAL_ADMIN', 'CUSTOM_READ_ONLY',
];

/** Masque partiel d'IP pour la vue standard (spec §15). */
function maskIp(ip?: string | null): string {
  if (!ip) return '—';
  const p = ip.split('.');
  return p.length === 4 ? `${p[0]}.${p[1]}.•••.•••` : `${ip.slice(0, 6)}…`;
}
function fmt(d?: string | null): string {
  return d ? new Date(d).toLocaleString('fr-FR') : '—';
}
function asArray<T = any>(data: any): T[] {
  return Array.isArray(data) ? data : Array.isArray(data?.data) ? data.data : [];
}

export function SecurityAccessPage() {
  const employee = useAuthStore((s) => s.employee);
  const [tab, setTab] = useState<Tab>('users');
  const isAdmin = employee?.role === 'admin';

  useEffect(() => {
    if (isAdmin) trackView({ action: 'TAB_OPEN', module: 'security', screen: tab });
  }, [tab, isAdmin]);

  // Gate dur : réservé à l'admin (rôle central de-facto). Aucun autre rôle n'entre.
  if (!isAdmin) return <Navigate to="/" replace />;

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <ShieldCheck className="text-indigo-600" />
        <h1 className="text-2xl font-semibold">Sécurité et accès</h1>
      </div>

      <div className="flex gap-1 border-b border-gray-200 mb-6">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 -mb-px ${
              tab === t.key ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            <t.icon size={16} />
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'users' && <UsersTab />}
      {tab === 'logins' && <LoginsTab />}
      {tab === 'activity' && <ActivityTab />}
      {tab === 'rights' && <RightsTab />}
    </div>
  );
}

// ─────────────────────────── Onglet Utilisateurs ───────────────────────────
function UsersTab() {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [grantFor, setGrantFor] = useState<string | null>(null);
  const [role, setRole] = useState(APPLICATION_ROLES[0]);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await employeesApi.list();
      setRows(asArray(res.data));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const grant = async (employeeId: string) => {
    await securityApi.grantApplicationAccess(employeeId, { applicationRole: role });
    setGrantFor(null);
    setMsg('Accès pilotage accordé.');
  };
  const suspend = async (employeeId: string) => { await securityApi.suspend(employeeId, 'suspension admin'); setMsg('Compte suspendu.'); };
  const reactivate = async (employeeId: string) => { await securityApi.reactivate(employeeId); setMsg('Compte réactivé.'); };
  const revokeAll = async (employeeId: string) => { await activityApi.revokeAll(employeeId, 'révocation admin'); setMsg('Sessions révoquées.'); };

  return (
    <div>
      {msg && <div className="mb-3 text-sm text-green-700 bg-green-50 px-3 py-2 rounded">{msg}</div>}
      <div className="overflow-x-auto border border-gray-200 rounded-lg">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50 text-gray-600">
            <tr>
              <th className="text-left px-4 py-2">Employé</th>
              <th className="text-left px-4 py-2">Rôle POS</th>
              <th className="text-left px-4 py-2">Statut</th>
              <th className="text-right px-4 py-2">Accès pilotage</th>
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={4} className="px-4 py-6 text-center text-gray-400">Chargement…</td></tr>}
            {!loading && rows.length === 0 && <tr><td colSpan={4} className="px-4 py-6 text-center text-gray-400">Aucun employé.</td></tr>}
            {rows.map((e) => (
              <tr key={e.id} className="border-t border-gray-100">
                <td className="px-4 py-2">{e.firstName} {e.lastName}</td>
                <td className="px-4 py-2">{e.role}</td>
                <td className="px-4 py-2">
                  <span className={e.isActive ? 'text-green-700' : 'text-gray-400'}>{e.isActive ? 'Actif' : 'Inactif'}</span>
                </td>
                <td className="px-4 py-2 text-right">
                  {grantFor === e.id ? (
                    <span className="inline-flex items-center gap-2">
                      <select value={role} onChange={(ev) => setRole(ev.target.value)} className="border rounded px-2 py-1 text-xs">
                        {APPLICATION_ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                      </select>
                      <button onClick={() => grant(e.id)} className="text-xs text-white bg-indigo-600 px-2 py-1 rounded">Accorder</button>
                      <button onClick={() => setGrantFor(null)} className="text-xs text-gray-500">Annuler</button>
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-2">
                      <button onClick={() => setGrantFor(e.id)} className="text-xs text-indigo-600">Accès…</button>
                      <button onClick={() => suspend(e.id)} className="text-xs text-amber-600">Suspendre</button>
                      <button onClick={() => reactivate(e.id)} className="text-xs text-green-600">Réactiver</button>
                      <button onClick={() => revokeAll(e.id)} className="text-xs text-red-600">Révoquer sessions</button>
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─────────────────────────── Onglet Connexions ───────────────────────────
function LoginsTab() {
  const [data, setData] = useState<{ data: any[]; total: number }>({ data: [], total: 0 });
  const [page, setPage] = useState(1);
  const [success, setSuccess] = useState<'' | 'true' | 'false'>('');
  const [employeeId, setEmployeeId] = useState('');
  const limit = 50;

  const load = useCallback(async () => {
    const res = await activityApi.loginEvents({
      page, limit,
      success: success === '' ? undefined : success === 'true',
      employeeId: employeeId || undefined,
    });
    setData({ data: asArray(res.data), total: res.data?.total ?? 0 });
  }, [page, success, employeeId]);
  useEffect(() => { void load(); }, [load]);

  return (
    <div>
      <div className="flex flex-wrap gap-2 mb-3">
        <select value={success} onChange={(e) => { setSuccess(e.target.value as any); setPage(1); }} className="border rounded px-2 py-1 text-sm">
          <option value="">Tous</option>
          <option value="true">Réussies</option>
          <option value="false">Échouées</option>
        </select>
        <input placeholder="employeeId" value={employeeId} onChange={(e) => { setEmployeeId(e.target.value); setPage(1); }} className="border rounded px-2 py-1 text-sm" />
        <button onClick={() => void load()} className="text-sm text-gray-600 inline-flex items-center gap-1"><RefreshCw size={14} /> Rafraîchir</button>
      </div>
      <div className="overflow-x-auto border border-gray-200 rounded-lg">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50 text-gray-600">
            <tr>
              <th className="text-left px-4 py-2">Date</th>
              <th className="text-left px-4 py-2">Résultat</th>
              <th className="text-left px-4 py-2">Méthode</th>
              <th className="text-left px-4 py-2">Employé</th>
              <th className="text-left px-4 py-2">IP</th>
              <th className="text-left px-4 py-2">Risque</th>
            </tr>
          </thead>
          <tbody>
            {data.data.length === 0 && <tr><td colSpan={6} className="px-4 py-6 text-center text-gray-400">Aucune connexion.</td></tr>}
            {data.data.map((r) => (
              <tr key={r.id} className="border-t border-gray-100">
                <td className="px-4 py-2">{fmt(r.occurredAt)}</td>
                <td className="px-4 py-2"><span className={r.success ? 'text-green-700' : 'text-red-600'}>{r.success ? 'Réussie' : 'Échouée'}</span></td>
                <td className="px-4 py-2">{r.authenticationMethod ?? '—'}</td>
                <td className="px-4 py-2">{r.employeeId ?? '—'}</td>
                <td className="px-4 py-2 font-mono text-xs">{maskIp(r.ipAddress)}</td>
                <td className="px-4 py-2">{r.riskScore > 0 ? <span className="text-amber-600">{r.riskScore}</span> : '0'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Pager page={page} total={data.total} limit={limit} onPage={setPage} />
    </div>
  );
}

// ─────────────────────────── Onglet Activité ───────────────────────────
function ActivityTab() {
  const [data, setData] = useState<{ data: any[]; total: number }>({ data: [], total: 0 });
  const [page, setPage] = useState(1);
  const [employeeId, setEmployeeId] = useState('');
  const [action, setAction] = useState('');
  const limit = 50;

  const load = useCallback(async () => {
    const res = await activityApi.viewEvents({ page, limit, employeeId: employeeId || undefined, action: action || undefined });
    setData({ data: asArray(res.data), total: res.data?.total ?? 0 });
  }, [page, employeeId, action]);
  useEffect(() => { void load(); }, [load]);

  return (
    <div>
      <div className="flex flex-wrap gap-2 mb-3">
        <input placeholder="employeeId" value={employeeId} onChange={(e) => { setEmployeeId(e.target.value); setPage(1); }} className="border rounded px-2 py-1 text-sm" />
        <input placeholder="action (ex. STORE_SELECTED)" value={action} onChange={(e) => { setAction(e.target.value); setPage(1); }} className="border rounded px-2 py-1 text-sm" />
      </div>
      <div className="border border-gray-200 rounded-lg divide-y divide-gray-100">
        {data.data.length === 0 && <div className="px-4 py-6 text-center text-gray-400">Aucune consultation.</div>}
        {data.data.map((r) => (
          <div key={r.id} className="px-4 py-2 flex items-center gap-3 text-sm">
            <span className="text-gray-400 w-40 shrink-0">{fmt(r.occurredAt)}</span>
            <span className="font-medium text-gray-800">{r.action}</span>
            <span className="text-gray-500">{[r.module, r.screen, r.storeId].filter(Boolean).join(' · ')}</span>
          </div>
        ))}
      </div>
      <Pager page={page} total={data.total} limit={limit} onPage={setPage} />
    </div>
  );
}

// ─────────────────────────── Onglet Audit des droits ───────────────────────────
function RightsTab() {
  const [rows, setRows] = useState<any[]>([]);
  const [chain, setChain] = useState<{ valid: boolean; reason?: string } | null>(null);

  const load = useCallback(async () => {
    const [list, verify] = await Promise.all([securityApi.auditList({ limit: 100 }), securityApi.auditVerify()]);
    setRows(asArray(list.data));
    setChain(verify.data);
  }, []);
  useEffect(() => { void load(); }, [load]);

  return (
    <div>
      <div className="mb-3">
        {chain && (
          <span className={`inline-flex items-center gap-2 text-sm px-3 py-1 rounded ${chain.valid ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
            {chain.valid ? <ShieldCheck size={16} /> : <ShieldAlert size={16} />}
            Chaîne d'audit {chain.valid ? 'intègre' : `ALTÉRÉE (${chain.reason})`}
          </span>
        )}
      </div>
      <div className="overflow-x-auto border border-gray-200 rounded-lg">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50 text-gray-600">
            <tr>
              <th className="text-left px-4 py-2">Date</th>
              <th className="text-left px-4 py-2">Auteur</th>
              <th className="text-left px-4 py-2">Événement</th>
              <th className="text-left px-4 py-2">Cible</th>
              <th className="text-left px-4 py-2">Magasin</th>
              <th className="text-left px-4 py-2">Motif</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={6} className="px-4 py-6 text-center text-gray-400">Aucun événement.</td></tr>}
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-gray-100">
                <td className="px-4 py-2">{fmt(r.occurredAt)}</td>
                <td className="px-4 py-2">{r.actorEmployeeId}</td>
                <td className="px-4 py-2 font-medium">{r.eventType}</td>
                <td className="px-4 py-2">{r.targetEmployeeId ?? '—'}</td>
                <td className="px-4 py-2">{r.storeId ?? '—'}</td>
                <td className="px-4 py-2 text-gray-500">{r.reason ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Pager({ page, total, limit, onPage }: { page: number; total: number; limit: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / limit));
  return (
    <div className="flex items-center justify-end gap-2 mt-3 text-sm text-gray-600">
      <span>{total} résultat(s) · page {page}/{pages}</span>
      <button disabled={page <= 1} onClick={() => onPage(page - 1)} className="p-1 disabled:opacity-30"><ChevronLeft size={16} /></button>
      <button disabled={page >= pages} onClick={() => onPage(page + 1)} className="p-1 disabled:opacity-30"><ChevronRight size={16} /></button>
    </div>
  );
}

export default SecurityAccessPage;
