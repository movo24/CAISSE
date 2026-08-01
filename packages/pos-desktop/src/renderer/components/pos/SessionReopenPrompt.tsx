import React, { useState } from 'react';
import { Wallet, X } from 'lucide-react';
import { usePOSStore } from '../../stores/posStore';

/**
 * Décision PURE : faut-il afficher le panneau de réouverture ?
 *
 * Visible dès qu'un caissier est connecté SANS session active, et que SOIT une
 * proposition réseau existe (`offered`, produite par le watcher sur transition
 * →online), SOIT l'ouverture de session a échoué (`openFailed`). Ce second cas
 * rend le panneau visible IMMÉDIATEMENT au retour du serveur, sans dépendre
 * d'une future transition offline→online — c'est le déblocage terrain.
 */
export function shouldShowReopenPrompt(opts: {
  hasEmployee: boolean;
  hasSession: boolean;
  offered: boolean;
  openFailed: boolean;
}): boolean {
  return opts.hasEmployee && !opts.hasSession && (opts.offered || opts.openFailed);
}

/**
 * Prompt NON BLOQUANT de réouverture de session au retour du serveur.
 *
 * Carte en coin d'écran — PAS de backdrop plein écran : les ventes continuent
 * pendant que le caissier décide (exigence owner). Le montant saisi est le
 * contenu ACTUEL du tiroir, transmis comme fond de la nouvelle session (ce qui
 * rend l'attendu correct pour la suite du service). Les ventes déjà passées
 * restent hors comptage — dit explicitement, jamais masqué.
 */
export function SessionReopenPrompt() {
  const offered = usePOSStore((s) => s.sessionReopenOffered);
  const openFailed = usePOSStore((s) => s.posSessionOpenFailed);
  const employee = usePOSStore((s) => s.employee);
  const posSession = usePOSStore((s) => s.posSession);
  const dismiss = usePOSStore((s) => s.dismissSessionReopen);
  const reopen = usePOSStore((s) => s.reopenSessionWithFloat);

  const reopenError = usePOSStore((s) => s.sessionReopenError);

  const forceLocalUnlock = usePOSStore((s) => s.forceLocalUnlock);
  const role = usePOSStore((s) => s.employee?.role);
  const isManager = role === 'manager' || role === 'admin';

  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Les ventes restent bloquées par la garde fiscale tant qu'aucune session
  // n'est adoptée — ce panneau EST le moyen de la rouvrir (décision pure ci-dessus).
  if (!shouldShowReopenPrompt({ hasEmployee: !!employee, hasSession: !!posSession?.id, offered, openFailed })) {
    return null;
  }

  const parseCentimes = (): number | null => {
    const normalized = value.trim().replace(/\s/g, '').replace(',', '.');
    if (!normalized) return null;
    const euros = Number(normalized);
    if (!Number.isFinite(euros) || euros < 0) return null;
    return Math.round(euros * 100);
  };

  const handleReopen = async () => {
    const centimes = parseCentimes();
    if (centimes === null) {
      setError('Saisis le contenu actuel du tiroir (ex : 187,50).');
      return;
    }
    setError(null);
    setSaving(true);
    const ok = await reopen(centimes);
    setSaving(false);
    if (!ok) {
      // Jamais un message générique : on affiche le CODE réel + l'identifiant.
      const e = usePOSStore.getState().sessionReopenError;
      setError(
        e
          ? `Réouverture impossible — ${e.message} · réf ${e.errorId}. Réessaie.`
          : 'Réouverture impossible — réessaie.',
      );
    }
  };

  return (
    <div className="fixed bottom-4 right-4 z-40 w-80 rounded-xl border border-pos-border bg-white shadow-xl p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <Wallet size={18} className="text-pos-accent" />
          <p className="text-sm font-bold text-pos-text">Serveur de retour</p>
        </div>
        <button onClick={dismiss} title="Plus tard (reproposé à la prochaine reconnexion)" className="text-pos-muted hover:text-pos-text">
          <X size={16} />
        </button>
      </div>
      <p className="mt-1 text-xs text-pos-muted">
        Rouvrir une session de caisse ? Saisis le contenu <strong>actuel</strong> du tiroir
        (il devient le fond de la session). Les ventes déjà passées resteront hors comptage.
      </p>
      {reopenError && (
        // Diagnostic RÉEL du dernier échec serveur (code HTTP + identifiant) —
        // jamais masqué derrière « le serveur ne répond pas ».
        <p className="mt-1 rounded bg-amber-50 px-2 py-1 text-[11px] font-mono text-amber-800">
          Dernier échec serveur : {reopenError.message} · réf {reopenError.errorId}
        </p>
      )}
      <div className="mt-3 flex items-center gap-2">
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          inputMode="decimal"
          placeholder="187,50"
          className="w-28 rounded-lg border border-pos-border px-2 py-1.5 text-sm tabular-nums"
        />
        <span className="text-xs text-pos-muted">€</span>
        <button
          onClick={handleReopen}
          disabled={saving}
          className="ml-auto rounded-lg bg-pos-accent px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
        >
          {saving ? '…' : 'Rouvrir la session'}
        </button>
      </div>
      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
      {isManager && (
        // Bouton MANAGER « Forcer le déverrouillage local » — filet de sécurité si
        // la bascule automatique en mode secours n'a pas eu lieu. Contourne
        // RÉELLEMENT le verrou de session serveur : ouvre une session locale
        // d'urgence avec le fond saisi (ou sans, à saisir ensuite). Les ventes
        // partent en file offline (aucune perte, sync idempotente au retour).
        <button
          onClick={() => {
            const centimes = parseCentimes();
            forceLocalUnlock(centimes);
          }}
          className="mt-2 w-full rounded-lg border border-amber-500 bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-800 hover:bg-amber-100"
        >
          Forcer le déverrouillage local (manager)
        </button>
      )}
    </div>
  );
}
