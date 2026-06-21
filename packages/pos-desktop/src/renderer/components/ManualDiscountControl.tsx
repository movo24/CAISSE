import { useState } from 'react';
import { Percent, X, Check } from 'lucide-react';
import { usePOSStore } from '../stores/posStore';
import { validateManualDiscount, MANUAL_DISCOUNT_MAX_PCT } from '../services/discount-policy';

/**
 * Manual cart discount control (decision 5). No free seller discount: the cashier
 * enters an amount + a manager approver code; the client mirror refuses >30% or a
 * missing approver before applying. The server re-validates (the guarantee).
 */
export function ManualDiscountControl() {
  const store = usePOSStore();
  const subtotal = store.subtotal();
  const active = store.manualDiscountMinorUnits > 0;

  const [open, setOpen] = useState(false);
  const [euro, setEuro] = useState('');
  const [approver, setApprover] = useState('');
  const [error, setError] = useState<string | null>(null);

  const fmt = (m: number) => (m / 100).toFixed(2).replace('.', ',') + ' €';

  const apply = () => {
    setError(null);
    const minor = Math.round(parseFloat(euro.replace(',', '.')) * 100);
    if (Number.isNaN(minor) || minor <= 0) {
      setError('Montant invalide');
      return;
    }
    const check = validateManualDiscount({ subtotalMinor: subtotal, manualDiscountMinor: minor, approverId: approver.trim() || null });
    if (!check.ok) {
      setError(check.reason || 'Remise refusée');
      return;
    }
    store.setManualDiscount(minor, approver.trim());
    setOpen(false);
    setEuro('');
    setApprover('');
  };

  const clear = () => store.setManualDiscount(0, null);

  if (subtotal <= 0) return null;

  if (active) {
    return (
      <div className="flex justify-between items-center text-sm text-pos-success">
        <span className="flex items-center gap-1.5"><Percent size={13} /> Remise responsable</span>
        <button onClick={clear} className="flex items-center gap-1 text-pos-muted hover:text-red-500" title="Retirer la remise">
          -{fmt(store.manualDiscountMinorUnits)} <X size={13} />
        </button>
      </div>
    );
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="w-full text-left text-xs text-pos-muted hover:text-pos-text flex items-center gap-1.5"
      >
        <Percent size={13} /> Ajouter une remise (validation responsable, max {MANUAL_DISCOUNT_MAX_PCT}%)
      </button>
    );
  }

  return (
    <div className="rounded-lg border border-pos-border/40 p-2.5 space-y-2 bg-black/5">
      <div className="flex gap-2">
        <input
          type="number" inputMode="decimal" step="0.01" min="0"
          value={euro} onChange={(e) => setEuro(e.target.value)} placeholder="Montant €"
          className="w-1/2 px-2 py-1 rounded-lg border border-pos-border/50 text-sm bg-transparent"
        />
        <input
          type="text" value={approver} onChange={(e) => setApprover(e.target.value)} placeholder="Code responsable"
          className="w-1/2 px-2 py-1 rounded-lg border border-pos-border/50 text-sm bg-transparent"
        />
      </div>
      {error && <p className="text-xs text-red-500">{error}</p>}
      <div className="flex gap-2 justify-end">
        <button onClick={() => { setOpen(false); setError(null); }} className="px-2 py-1 text-xs text-pos-muted hover:text-pos-text flex items-center gap-1"><X size={13} /> Annuler</button>
        <button onClick={apply} className="px-3 py-1 text-xs font-semibold rounded-lg bg-pos-accent text-white flex items-center gap-1"><Check size={13} /> Appliquer</button>
      </div>
    </div>
  );
}
