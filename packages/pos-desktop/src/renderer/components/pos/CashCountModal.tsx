import React, { useState } from 'react';
import { LogOut, X } from 'lucide-react';
import { usePOSStore } from '../../stores/posStore';
import { usePerformanceStore } from '../../stores/performanceStore';
import { usePointageStore } from '../../stores/pointageStore';
import { posEventBus } from '../../services/posEventBus';

/**
 * Comptage caisse à la fermeture explicite d'une session.
 *
 * Le caissier saisit UNIQUEMENT le montant compté physiquement. Le montant
 * attendu et l'écart sont calculés côté serveur (fond d'ouverture + ventes
 * espèces rattachées à la session) — jamais affichés comme modifiables ni
 * envoyés par le client. La saisie est facultative : « Fermer sans compter »
 * clôt la session sans comptage (le backend laisse alors les champs cash nuls).
 */
export function CashCountModal() {
  const open = usePOSStore((s) => s.cashCountOpen);
  const closeCashCount = usePOSStore((s) => s.closeCashCount);
  const logout = usePOSStore((s) => s.logout);
  const employee = usePOSStore((s) => s.employee);
  const storeInfo = usePOSStore((s) => s.storeInfo);
  const posSession = usePOSStore((s) => s.posSession);

  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  /** Effets de bord communs à toute fermeture explicite (sync, event, pointage). */
  const runCloseSideEffects = () => {
    usePerformanceStore.getState().flushToSyncQueue();
    if (employee) {
      posEventBus.emit('SESSION_CLOSED', {
        storeId: storeInfo?.siret || employee.storeId || 'unknown',
        cashierId: employee.id,
        cashierName: `${employee.firstName} ${employee.lastName}`,
        timestamp: new Date().toISOString(),
        reason: 'manual_logout',
      });
      usePointageStore.getState().clockOut();
    }
  };

  const parseCentimes = (): number | null => {
    const normalized = value.trim().replace(',', '.');
    if (!normalized) return null;
    const euros = Number(normalized);
    if (!Number.isFinite(euros) || euros < 0) return null;
    return Math.round(euros * 100);
  };

  const handleConfirm = () => {
    const centimes = parseCentimes();
    if (centimes === null) {
      setError('Saisis un montant valide (ex : 152,40).');
      return;
    }
    runCloseSideEffects();
    logout(centimes); // seul le compté part au serveur
  };

  const handleSkip = () => {
    runCloseSideEffects();
    logout(); // fermeture sans comptage → champs cash nuls côté serveur
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-sm rounded-2xl bg-white shadow-elevated border border-pos-border/30">
        <div className="flex items-center justify-between px-5 py-4 border-b border-pos-border/30">
          <h2 className="text-base font-semibold text-pos-text">Fermeture de caisse</h2>
          <button
            onClick={() => { setError(null); closeCashCount(); }}
            className="text-pos-muted hover:text-pos-text"
            aria-label="Annuler"
          >
            <X size={18} />
          </button>
        </div>

        <div className="px-5 py-4 space-y-4">
          <p className="text-sm text-pos-muted">
            Compte les espèces réellement présentes dans le tiroir et saisis le montant.
            L&apos;écart avec le montant attendu est calculé automatiquement côté serveur.
          </p>

          <label className="block">
            <span className="text-xs font-semibold text-pos-muted uppercase tracking-wide">
              Montant compté (espèces)
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
        </div>

        <div className="px-5 py-4 border-t border-pos-border/30 space-y-2">
          <button
            onClick={handleConfirm}
            className="w-full flex items-center justify-center gap-2 rounded-xl bg-pos-accent px-4 py-2.5 text-sm font-semibold text-white hover:opacity-90 transition-opacity"
          >
            <LogOut size={15} /> Valider et fermer
          </button>
          <button
            onClick={handleSkip}
            className="w-full rounded-xl px-4 py-2 text-sm font-medium text-pos-muted hover:bg-pos-subtle transition-colors"
          >
            Fermer sans compter
          </button>
        </div>
      </div>
    </div>
  );
}
