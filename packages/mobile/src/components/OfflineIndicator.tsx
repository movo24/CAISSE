// ── OfflineIndicator ─────────────────────────────────────────────
// Barre fine de statut : online/offline + nombre de comptages en attente.
// ─────────────────────────────────────────────────────────────────
import { useEffect } from 'react';
import { Wifi, WifiOff, RefreshCw, CloudUpload } from 'lucide-react';
import { useOfflineStore } from '../stores/offlineStore';

export function OfflineIndicator() {
  const status = useOfflineStore((s) => s.status);
  const outstanding = useOfflineStore((s) => s.outstanding);
  const syncing = useOfflineStore((s) => s.syncing);
  const init = useOfflineStore((s) => s.init);
  const syncNow = useOfflineStore((s) => s.syncNow);

  useEffect(() => {
    init();
  }, [init]);

  const offline = status === 'offline';

  return (
    <div
      className={`flex items-center justify-between px-4 py-1.5 text-xs font-semibold safe-top ${
        offline ? 'bg-amber-100 text-amber-800' : 'bg-emerald-50 text-emerald-700'
      }`}
    >
      <span className="flex items-center gap-1.5">
        {offline ? <WifiOff size={14} /> : <Wifi size={14} />}
        {offline ? 'Hors ligne' : 'En ligne'}
      </span>

      <button
        onClick={() => void syncNow()}
        disabled={syncing || offline}
        className="flex items-center gap-1.5 disabled:opacity-50"
      >
        {outstanding > 0 ? (
          <>
            <CloudUpload size={14} />
            {outstanding} en attente
          </>
        ) : (
          <>Synchronisé</>
        )}
        {syncing && <RefreshCw size={13} className="animate-spin" />}
      </button>
    </div>
  );
}
