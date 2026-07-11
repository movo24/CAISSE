import React, { useState, useEffect, useCallback } from 'react';
import {
  MonitorSmartphone,
  CheckCircle2,
  XCircle,
  Ban,
  ShieldCheck,
  ShieldAlert,
  RefreshCw,
} from 'lucide-react';
import { enrollmentApi, storesApi, type PosMachine } from '../services/api';
import { useAuthStore } from '../stores/authStore';

const STATUS_LABEL: Record<PosMachine['status'], string> = {
  pending: 'En attente',
  approved: 'Approuvée',
  rejected: 'Rejetée',
  revoked: 'Révoquée',
};

const STATUS_STYLE: Record<PosMachine['status'], string> = {
  pending: 'bg-amber-100 text-amber-800',
  approved: 'bg-emerald-100 text-emerald-800',
  rejected: 'bg-red-100 text-red-700',
  revoked: 'bg-gray-200 text-gray-600',
};

/**
 * Enrôlement machine POS (Partie B) — le back-office valide les caisses qui se
 * déclarent. Approuver / rejeter / révoquer (manager+admin). L'interrupteur
 * « exiger l'enrôlement » du magasin est réservé à l'admin (bloque la vente des
 * caisses non validées quand il est activé).
 */
export function PosEnrollmentPage() {
  const employee = useAuthStore((s) => s.employee);
  const role = employee?.role;
  const storeId = employee?.storeId;
  const isAdmin = role === 'admin';

  const [machines, setMachines] = useState<PosMachine[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [enforced, setEnforced] = useState<boolean | null>(null);
  const [savingFlag, setSavingFlag] = useState(false);

  const flash = (msg: string) => {
    setSuccess(msg);
    setTimeout(() => setSuccess(null), 3000);
  };

  const load = useCallback(async () => {
    try {
      setError(null);
      const [mres, sres] = await Promise.all([
        enrollmentApi.list(),
        storeId ? storesApi.get(storeId) : Promise.resolve(null as any),
      ]);
      setMachines(mres.data || []);
      if (sres?.data) setEnforced(!!sres.data.enrollmentEnforced);
    } catch (err: any) {
      setError(err.response?.data?.message || "Impossible de charger l'enrôlement.");
    } finally {
      setLoading(false);
    }
  }, [storeId]);

  useEffect(() => {
    load();
  }, [load]);

  const approve = async (m: PosMachine) => {
    await enrollmentApi.approve(m.id);
    flash(`Caisse « ${m.terminalLabel} » approuvée.`);
    load();
  };

  const reject = async (m: PosMachine) => {
    const reason = window.prompt('Motif du rejet (facultatif) :') ?? '';
    await enrollmentApi.reject(m.id, reason);
    flash(`Caisse « ${m.terminalLabel} » rejetée.`);
    load();
  };

  const revoke = async (m: PosMachine) => {
    const reason = window.prompt('Motif de la révocation (facultatif) :') ?? '';
    if (!window.confirm(`Révoquer « ${m.terminalLabel} » ? La caisse ne pourra plus vendre si l'enrôlement est exigé.`)) return;
    await enrollmentApi.revoke(m.id, reason);
    flash(`Caisse « ${m.terminalLabel} » révoquée.`);
    load();
  };

  const toggleEnforced = async () => {
    if (!storeId || enforced === null) return;
    const next = !enforced;
    if (
      next &&
      !window.confirm(
        'Activer l’exigence d’enrôlement ? Les caisses NON approuvées de ce magasin ne pourront plus vendre.',
      )
    )
      return;
    setSavingFlag(true);
    try {
      await storesApi.update(storeId, { enrollmentEnforced: next });
      setEnforced(next);
      flash(next ? 'Enrôlement désormais EXIGÉ pour ce magasin.' : 'Enrôlement non exigé (les caisses vendent librement).');
    } catch (err: any) {
      setError(err.response?.data?.message || 'Échec de la mise à jour du magasin.');
    } finally {
      setSavingFlag(false);
    }
  };

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <MonitorSmartphone className="text-bo-accent" />
          <div>
            <h1 className="text-xl font-bold">Enrôlement des caisses</h1>
            <p className="text-sm text-bo-muted">
              Validez les machines POS qui se déclarent. Une caisse non approuvée est bloquée uniquement si l’enrôlement est exigé.
            </p>
          </div>
        </div>
        <button
          onClick={load}
          className="flex items-center gap-2 px-3 py-2 rounded-lg border text-sm hover:bg-gray-50"
        >
          <RefreshCw size={15} /> Rafraîchir
        </button>
      </div>

      {/* Interrupteur magasin (admin seulement) */}
      <div className="mb-6 p-4 rounded-xl border flex items-center justify-between">
        <div className="flex items-center gap-3">
          {enforced ? (
            <ShieldCheck className="text-emerald-600" />
          ) : (
            <ShieldAlert className="text-amber-500" />
          )}
          <div>
            <p className="font-semibold">
              Exiger l’enrôlement pour ce magasin :{' '}
              <span className={enforced ? 'text-emerald-700' : 'text-amber-700'}>
                {enforced === null ? '—' : enforced ? 'OUI' : 'NON'}
              </span>
            </p>
            <p className="text-xs text-bo-muted">
              {enforced
                ? 'Les caisses non approuvées ne peuvent pas vendre.'
                : 'Défaut sûr : les caisses existantes vendent normalement.'}
            </p>
          </div>
        </div>
        <button
          onClick={toggleEnforced}
          disabled={!isAdmin || savingFlag || enforced === null}
          title={!isAdmin ? 'Réservé à l’administrateur' : undefined}
          className={`px-4 py-2 rounded-lg text-sm font-semibold text-white ${
            !isAdmin || enforced === null
              ? 'bg-gray-300 cursor-not-allowed'
              : enforced
                ? 'bg-amber-600 hover:bg-amber-700'
                : 'bg-emerald-600 hover:bg-emerald-700'
          }`}
        >
          {enforced ? 'Désactiver' : 'Activer'}
        </button>
      </div>

      {error && <div className="mb-4 p-3 rounded-lg bg-red-50 text-red-700 text-sm">{error}</div>}
      {success && <div className="mb-4 p-3 rounded-lg bg-emerald-50 text-emerald-700 text-sm">{success}</div>}

      {loading ? (
        <p className="text-bo-muted">Chargement…</p>
      ) : machines.length === 0 ? (
        <p className="text-bo-muted">Aucune caisse déclarée pour ce magasin.</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50/50 text-left text-bo-muted">
                <th className="p-3 font-medium">Terminal</th>
                <th className="p-3 font-medium">Machine</th>
                <th className="p-3 font-medium">Statut</th>
                <th className="p-3 font-medium">Vue</th>
                <th className="p-3 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {machines.map((m) => (
                <tr key={m.id} className="border-t hover:bg-gray-50/40">
                  <td className="p-3">
                    <div className="font-semibold">{m.terminalLabel}</div>
                    {m.machineName && <div className="text-xs text-bo-muted">{m.machineName}</div>}
                  </td>
                  <td className="p-3">
                    <div className="font-mono text-xs">{m.machineId}</div>
                    <div className="text-xs text-bo-muted">
                      {m.platform || '—'}{m.appVersion ? ` · v${m.appVersion}` : ''}
                    </div>
                  </td>
                  <td className="p-3">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_STYLE[m.status]}`}>
                      {STATUS_LABEL[m.status]}
                    </span>
                    {m.decisionReason && <div className="text-xs text-bo-muted mt-1">{m.decisionReason}</div>}
                  </td>
                  <td className="p-3 text-xs text-bo-muted">
                    {m.lastSeenAt ? new Date(m.lastSeenAt).toLocaleString('fr-FR') : '—'}
                  </td>
                  <td className="p-3">
                    <div className="flex items-center justify-end gap-2">
                      {m.status !== 'approved' && (
                        <button
                          onClick={() => approve(m)}
                          className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-emerald-600 text-white text-xs hover:bg-emerald-700"
                        >
                          <CheckCircle2 size={14} /> Approuver
                        </button>
                      )}
                      {m.status === 'pending' && (
                        <button
                          onClick={() => reject(m)}
                          className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg border text-xs hover:bg-gray-50"
                        >
                          <XCircle size={14} /> Rejeter
                        </button>
                      )}
                      {m.status === 'approved' && (
                        <button
                          onClick={() => revoke(m)}
                          className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-red-200 text-red-600 text-xs hover:bg-red-50"
                        >
                          <Ban size={14} /> Révoquer
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default PosEnrollmentPage;
