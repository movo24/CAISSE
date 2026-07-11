import React, { useState } from 'react';
import { Download, RefreshCw, CheckCircle2, AlertTriangle } from 'lucide-react';
import { useAutoUpdate } from '../hooks/useAutoUpdate';

/**
 * Bandeau discret de mise à jour (coin bas-droit). N'apparaît QUE quand une
 * mise à jour est en cours/prête/en échec — sinon rien. Ne bloque jamais la
 * caisse. Monté une seule fois dans le POS desktop : tant qu'il est monté, il
 * remonte aussi l'activité (panier/sync) au contrôleur de mise à jour.
 *
 * L'installation « à un moment contrôlé » : la MAJ s'installe de toute façon à
 * la fermeture de l'app (jamais en pleine vente). Le bouton « Redémarrer et
 * installer » permet de le faire tout de suite quand la caisse est au repos ;
 * il est refusé côté main si une vente / un paiement / une impression / une
 * sync est en cours.
 */
const REASON_LABEL: Record<string, string> = {
  payment: 'un paiement est en cours',
  printing: 'une impression est en cours',
  sale: 'une vente est en cours',
  syncing: 'une synchronisation est en cours',
};

export function UpdateBanner() {
  const { state, installNow } = useAutoUpdate();
  const [busyMsg, setBusyMsg] = useState<string | null>(null);
  const [installing, setInstalling] = useState(false);

  if (!state) return null;
  const { phase, availableVersion, progressPercent } = state;
  if (phase === 'idle' || phase === 'not-available' || phase === 'checking' || phase === 'disabled') {
    return null;
  }

  const handleInstall = async () => {
    setBusyMsg(null);
    setInstalling(true);
    const res = await installNow();
    setInstalling(false);
    if (!res.ok) {
      const why = res.reason && REASON_LABEL[res.reason] ? REASON_LABEL[res.reason] : 'la caisse est occupée';
      setBusyMsg(`Installation différée : ${why}. Elle se fera à la fermeture.`);
    }
  };

  const base =
    'fixed bottom-4 right-4 z-[9000] max-w-sm rounded-xl px-4 py-3 shadow-2xl text-sm border';

  if (phase === 'downloading') {
    return (
      <div className={`${base} bg-slate-900 text-white border-white/10`} role="status">
        <div className="flex items-center gap-2 font-semibold">
          <Download size={16} className="animate-pulse" /> Téléchargement de la mise à jour…
        </div>
        <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-white/15">
          <div className="h-full bg-emerald-400 transition-all" style={{ width: `${progressPercent}%` }} />
        </div>
      </div>
    );
  }

  if (phase === 'available') {
    return (
      <div className={`${base} bg-slate-900 text-white border-white/10`} role="status">
        <div className="flex items-center gap-2">
          <Download size={16} /> Mise à jour {availableVersion ? `v${availableVersion} ` : ''}disponible — téléchargement…
        </div>
      </div>
    );
  }

  if (phase === 'downloaded') {
    return (
      <div className={`${base} bg-emerald-600 text-white border-emerald-400/30`} role="status">
        <div className="flex items-center gap-2 font-semibold">
          <CheckCircle2 size={16} /> Mise à jour {availableVersion ? `v${availableVersion} ` : ''}prête
        </div>
        <p className="mt-1 text-white/85 text-[13px]">
          Elle s'installera à la fermeture de la caisse. Vous pouvez l'installer maintenant si la caisse est au repos.
        </p>
        {busyMsg && <p className="mt-1 text-amber-100 text-[13px]">{busyMsg}</p>}
        <button
          onClick={handleInstall}
          disabled={installing}
          className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-white/15 px-3 py-1.5 font-semibold hover:bg-white/25 disabled:opacity-60"
        >
          <RefreshCw size={14} className={installing ? 'animate-spin' : ''} /> Redémarrer et installer
        </button>
      </div>
    );
  }

  // phase === 'error' — discret, non bloquant.
  return (
    <div className={`${base} bg-slate-800 text-amber-200 border-amber-500/20`} role="status">
      <div className="flex items-center gap-2">
        <AlertTriangle size={16} /> Vérification des mises à jour indisponible (la caisse fonctionne normalement).
      </div>
    </div>
  );
}
