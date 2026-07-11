import React, { useEffect, useState } from 'react';
import { RefreshCw, Link2, Link2Off } from 'lucide-react';
import { storesApi } from '../services/api';
import { useAuthStore } from '../stores/authStore';

/**
 * Interrupteur « Synchronisation TimeWin24 » par magasin (Partie C).
 *
 * Rien n'est natif : la remontée TW24 (ventes, sessions, pointage, stock) est
 * OPTIONNELLE et se pilote ici, par magasin. Réservé à l'admin. Le magasin est
 * celui de l'opérateur connecté.
 */
export function Tw24SyncToggle() {
  const employee = useAuthStore((s) => s.employee);
  const storeId = employee?.storeId;
  const isAdmin = employee?.role === 'admin';

  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    if (!storeId) return;
    storesApi
      .get(storeId)
      .then((r) => alive && setEnabled(!!r.data?.tw24Enabled))
      .catch(() => alive && setEnabled(null));
    return () => {
      alive = false;
    };
  }, [storeId]);

  if (!storeId || enabled === null) return null;

  const toggle = async () => {
    if (!isAdmin || saving) return;
    const next = !enabled;
    setSaving(true);
    setError(null);
    try {
      await storesApi.update(storeId, { tw24Enabled: next });
      setEnabled(next);
    } catch (e: any) {
      setError(e?.response?.data?.message || 'Échec');
    } finally {
      setSaving(false);
    }
  };

  return (
    <button
      onClick={toggle}
      disabled={!isAdmin || saving}
      title={
        !isAdmin
          ? 'Réservé à l’administrateur'
          : enabled
            ? 'Désactiver la synchro TimeWin24 pour ce magasin'
            : 'Activer la synchro TimeWin24 pour ce magasin'
      }
      className={`inline-flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-semibold border transition-colors ${
        enabled
          ? 'bg-emerald-50 border-emerald-200 text-emerald-700 hover:bg-emerald-100'
          : 'bg-gray-50 border-gray-200 text-gray-500 hover:bg-gray-100'
      } ${!isAdmin ? 'opacity-70 cursor-not-allowed' : ''}`}
    >
      {saving ? (
        <RefreshCw size={14} className="animate-spin" />
      ) : enabled ? (
        <Link2 size={14} />
      ) : (
        <Link2Off size={14} />
      )}
      TimeWin24 : {enabled ? 'activé' : 'désactivé'}
      {error && <span className="text-red-500 ml-1">({error})</span>}
    </button>
  );
}

export default Tw24SyncToggle;
