import React, { useState } from 'react';
import { Wallet, X } from 'lucide-react';
import { usePOSStore } from '../../stores/posStore';

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
  const posSession = usePOSStore((s) => s.posSession);
  const dismiss = usePOSStore((s) => s.dismissSessionReopen);
  const reopen = usePOSStore((s) => s.reopenSessionWithFloat);

  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  if (!offered || posSession?.id) return null;

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
    if (!ok) setError('Réouverture impossible — le serveur ne répond pas. Réessaie.');
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
    </div>
  );
}
