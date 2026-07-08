import React, { useState } from 'react';
import { Wallet, ArrowRight } from 'lucide-react';
import { usePOSStore } from '../../stores/posStore';

/**
 * Saisie du fond de caisse à l'OUVERTURE de session.
 *
 * Le caissier déclare le montant en espèces présent dans le tiroir au début du
 * service. Ce montant est transmis au serveur, stocké sur la session et intégré
 * à l'attendu caisse (fond + ventes espèces − remboursements). Il se saisit
 * UNE fois à l'ouverture ; toute correction ultérieure passe par un
 * manager/admin (règle serveur, tracée). « Fond inconnu » laisse la valeur nulle
 * (état auditable), sans bloquer la caisse.
 */
export function CashOpenModal() {
  const open = usePOSStore((s) => s.openingCashRequired);
  const declareOpeningCash = usePOSStore((s) => s.declareOpeningCash);
  const dismiss = usePOSStore((s) => s.dismissOpeningCash);
  const posSession = usePOSStore((s) => s.posSession);

  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  if (!open) return null;

  const parseCentimes = (): number | null => {
    const normalized = value.trim().replace(',', '.');
    if (!normalized) return null;
    const euros = Number(normalized);
    if (!Number.isFinite(euros) || euros < 0) return null;
    return Math.round(euros * 100);
  };

  const handleConfirm = async () => {
    const centimes = parseCentimes();
    if (centimes === null) {
      setError('Saisis un montant valide (ex : 150,00).');
      return;
    }
    setSaving(true);
    await declareOpeningCash(centimes); // seul le fond part au serveur
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-sm rounded-2xl bg-white shadow-elevated border border-pos-border/30">
        <div className="flex items-center gap-2 px-5 py-4 border-b border-pos-border/30">
          <Wallet size={18} className="text-pos-accent" />
          <h2 className="text-base font-semibold text-pos-text">Fond de caisse — ouverture</h2>
        </div>

        <div className="px-5 py-4 space-y-4">
          <p className="text-sm text-pos-muted">
            Compte les espèces présentes dans le tiroir en début de service et saisis le montant.
            Il sera intégré au calcul de l&apos;écart à la fermeture.
          </p>

          <label className="block">
            <span className="text-xs font-semibold text-pos-muted uppercase tracking-wide">
              Fond de caisse (espèces)
            </span>
            <div className="mt-1 flex items-center gap-2">
              <input
                type="text"
                inputMode="decimal"
                autoFocus
                value={value}
                onChange={(e) => { setValue(e.target.value); setError(null); }}
                onKeyDown={(e) => { if (e.key === 'Enter') handleConfirm(); }}
                placeholder="0,00"
                className="w-full rounded-xl border border-pos-border/50 px-3 py-2.5 text-lg font-semibold text-pos-text focus:outline-none focus:ring-2 focus:ring-pos-accent/40"
              />
              <span className="text-lg font-semibold text-pos-muted">€</span>
            </div>
            {error && <span className="mt-1 block text-xs text-pos-danger">{error}</span>}
          </label>

          {posSession?.terminalId && (
            <p className="text-[11px] text-pos-muted">Terminal : {posSession.terminalId}</p>
          )}
          <p className="text-[11px] text-pos-muted">
            Une correction après ouverture nécessite un responsable (tracée).
          </p>
        </div>

        <div className="px-5 py-4 border-t border-pos-border/30 space-y-2">
          <button
            onClick={handleConfirm}
            disabled={saving}
            className="w-full flex items-center justify-center gap-2 rounded-xl bg-pos-accent px-4 py-2.5 text-sm font-semibold text-white hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            Valider le fond <ArrowRight size={15} />
          </button>
          <button
            onClick={dismiss}
            disabled={saving}
            className="w-full rounded-xl px-4 py-2 text-sm font-medium text-pos-muted hover:bg-pos-subtle transition-colors"
          >
            Fond inconnu / passer
          </button>
        </div>
      </div>
    </div>
  );
}
