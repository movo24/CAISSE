import { useState } from 'react';
import { Ticket, X, Check, Loader2 } from 'lucide-react';
import { usePOSStore } from '../stores/posStore';
import { promoCodesApi } from '../services/api';

/**
 * Promo-code entry at the sale (decision 6). The cashier types a code; we validate
 * it for instant feedback (existence / window / cap / scope), then store it. The
 * discount is computed LIVE by the store getter (mirrors the server base), and the
 * server re-validates + redeems the code ATOMICALLY when the sale is created — the
 * server is the guarantee.
 */
export function PromoCodeControl() {
  const store = usePOSStore();
  const subtotal = store.subtotal();
  const active = !!store.promoCode;

  const [open, setOpen] = useState(false);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const fmt = (m: number) => (m / 100).toFixed(2).replace('.', ',') + ' €';

  const apply = async () => {
    setError(null);
    const c = code.trim().toUpperCase();
    if (!c) {
      setError('Saisir un code');
      return;
    }
    setBusy(true);
    try {
      const res = await promoCodesApi.validate(c);
      const v = res.data;
      if (!v?.valid) {
        setError(v?.reason || 'Code refusé');
        return;
      }
      store.setPromoCode(c, { discountType: v.discountType, discountValue: v.discountValue });
      setOpen(false);
      setCode('');
    } catch (e: any) {
      setError(e?.response?.data?.message || 'Code refusé');
    } finally {
      setBusy(false);
    }
  };

  const clear = () => store.clearPromoCode();

  if (subtotal <= 0) return null;

  if (active) {
    return (
      <div className="flex justify-between items-center text-sm text-pos-success">
        <span className="flex items-center gap-1.5"><Ticket size={13} /> Code {store.promoCode}</span>
        <button onClick={clear} className="flex items-center gap-1 text-pos-muted hover:text-red-500" title="Retirer le code">
          -{fmt(store.promoDiscount())} <X size={13} />
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
        <Ticket size={13} /> Ajouter un code promo
      </button>
    );
  }

  return (
    <div className="rounded-lg border border-pos-border/40 p-2.5 space-y-2 bg-black/5">
      <input
        type="text" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="Code promo"
        className="w-full px-2 py-1 rounded-lg border border-pos-border/50 text-sm bg-transparent uppercase"
        onKeyDown={(e) => { if (e.key === 'Enter') apply(); }}
        autoFocus
      />
      {error && <p className="text-xs text-red-500">{error}</p>}
      <div className="flex gap-2 justify-end">
        <button onClick={() => { setOpen(false); setError(null); }} className="px-2 py-1 text-xs text-pos-muted hover:text-pos-text flex items-center gap-1"><X size={13} /> Annuler</button>
        <button onClick={apply} disabled={busy} className="px-3 py-1 text-xs font-semibold rounded-lg bg-pos-accent text-white flex items-center gap-1 disabled:opacity-50">
          {busy ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />} Appliquer
        </button>
      </div>
    </div>
  );
}
