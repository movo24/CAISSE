import React, { useState } from 'react';
import { X, Loader2, Ticket } from 'lucide-react';
import { returnsApi } from '../../services/api';

/**
 * Avoir (store-credit) tender entry — scan/type a credit-note code, validate its
 * balance server-side, then apply min(balance, amountDue) as a store_credit tender.
 * The backend re-validates + locks the avoir at sale time (single source of truth).
 */
export function AvoirTenderModal({
  amountDueMinor,
  onApply,
  onClose,
}: {
  amountDueMinor: number;
  onApply: (code: string, amountMinorUnits: number) => void;
  onClose: () => void;
}) {
  const [code, setCode] = useState('');
  const [checking, setChecking] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const eur = (c: number) => (c / 100).toFixed(2) + ' €';

  const apply = async () => {
    const c = code.trim().toUpperCase();
    if (!c) { setErr('Saisissez un code avoir.'); return; }
    setChecking(true);
    setErr(null);
    try {
      const res = await returnsApi.lookupCreditNote(c);
      const data = res.data;
      if (!data?.spendable) {
        setErr('Avoir invalide, déjà utilisé ou solde nul.');
        return;
      }
      const applied = Math.min(data.remainingMinorUnits, amountDueMinor);
      if (applied <= 0) { setErr('Rien à régler avec cet avoir.'); return; }
      onApply(data.code, applied);
    } catch (e: any) {
      setErr(e?.response?.status === 404 ? 'Avoir introuvable.' : (e?.response?.data?.message || 'Erreur de vérification.'));
    } finally {
      setChecking(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-sm bg-white rounded-3xl shadow-2xl p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-bold text-gray-900 flex items-center gap-2"><Ticket size={18} className="text-emerald-600" /> Payer par avoir</h3>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100"><X size={18} className="text-gray-500" /></button>
        </div>
        <p className="text-xs text-gray-500 mb-2">Reste à payer : <strong>{eur(amountDueMinor)}</strong></p>
        <input
          type="text"
          value={code}
          onChange={(e) => { setCode(e.target.value.toUpperCase()); if (err) setErr(null); }}
          onKeyDown={(e) => { if (e.key === 'Enter') apply(); }}
          placeholder="Code avoir (ex: AV-XXXXXXXXXX)"
          autoFocus
          className="w-full px-4 py-3 rounded-2xl border border-gray-200 text-sm font-mono tracking-wide focus:outline-none focus:ring-2 focus:ring-emerald-400/40"
        />
        {err && <p className="text-xs text-red-500 mt-2">{err}</p>}
        <div className="flex gap-3 mt-5">
          <button onClick={onClose} className="flex-1 py-3 rounded-2xl border border-gray-200 text-sm font-semibold text-gray-500">Annuler</button>
          <button onClick={apply} disabled={checking} className="flex-1 py-3 rounded-2xl bg-emerald-600 text-white text-sm font-semibold disabled:opacity-50 flex items-center justify-center gap-2">
            {checking && <Loader2 size={14} className="animate-spin" />} Appliquer
          </button>
        </div>
      </div>
    </div>
  );
}
