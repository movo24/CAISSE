import { useMemo, useState } from 'react';
import { X, Percent, Euro, Check, ShieldCheck, Receipt, ListOrdered } from 'lucide-react';
import { usePOSStore } from '../../stores/posStore';
import { validateManualDiscount, MANUAL_DISCOUNT_MAX_PCT } from '../../services/discount-policy';

/**
 * Remise — modale unifiée (refonte premium).
 *
 * Portée : ticket entier OU une ligne (le montant est alors calculé sur cette
 * ligne). Mode : € fixe ou %. Règles métier INCHANGÉES (décision 5) :
 *  - plafond dur 30 % du sous-total ;
 *  - code responsable OBLIGATOIRE ;
 *  - motif OBLIGATOIRE (journalisé) ;
 *  - le serveur re-valide (plafond + rôle approbateur) — garantie non contournable.
 *
 * IMPORTANT (invariant serveur) : le serveur REMET À ZÉRO les remises ligne
 * envoyées par le client et redistribue lui-même la remise manuelle plafonnée
 * sur les lignes (sales.service). La portée « ligne » sert donc à CALCULER le
 * montant depuis la ligne choisie, puis l'applique via la remise manuelle
 * serveur — jamais en écrivant discountMinorUnits côté client (divergence
 * de total interdite).
 */
export function RemiseModal({ onClose }: { onClose: () => void }) {
  const store = usePOSStore();
  const subtotal = store.subtotal();
  const existing = store.manualDiscountMinorUnits;

  const [scope, setScope] = useState<'ticket' | 'line'>('ticket');
  const [lineId, setLineId] = useState<string | null>(store.cartItems[0]?.productId ?? null);
  const [mode, setMode] = useState<'euro' | 'percent'>('euro');
  const [value, setValue] = useState('');
  const [approver, setApprover] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  const fmt = (m: number) => (m / 100).toFixed(2).replace('.', ',') + ' €';

  const line = useMemo(
    () => store.cartItems.find((i) => i.productId === lineId) ?? null,
    [store.cartItems, lineId],
  );
  const base = scope === 'ticket' ? subtotal : (line ? line.unitPriceMinorUnits * line.quantity : 0);

  const amountMinor = useMemo(() => {
    const v = parseFloat(value.replace(',', '.'));
    if (Number.isNaN(v) || v <= 0) return 0;
    const raw = mode === 'euro' ? Math.round(v * 100) : Math.floor(base * (v / 100));
    return Math.min(Math.max(0, raw), base); // jamais au-delà de la base choisie
  }, [value, mode, base]);

  const capMinor = Math.floor(subtotal * (MANUAL_DISCOUNT_MAX_PCT / 100));

  const apply = () => {
    setError(null);
    if (amountMinor <= 0) { setError('Montant invalide.'); return; }
    if (!reason.trim()) { setError('Motif obligatoire.'); return; }
    if (scope === 'line' && !line) { setError('Sélectionnez une ligne.'); return; }

    const newTotal = existing + amountMinor;
    const pct = subtotal > 0 ? (newTotal / subtotal) * 100 : 0;
    const check = validateManualDiscount({
      subtotalMinor: subtotal,
      manualDiscountMinor: newTotal,
      approverId: approver.trim() || null,
    });
    if (!check.ok) {
      // Fait objectif signé (tentative hors procédure) — même si bloquée client.
      if (pct > MANUAL_DISCOUNT_MAX_PCT) {
        store.logScoreEvent('DISCOUNT_ABOVE_LIMIT', `Tentative remise ${pct.toFixed(1)}% > ${MANUAL_DISCOUNT_MAX_PCT}%`);
      } else if (!approver.trim()) {
        store.logScoreEvent('DISCOUNT_WITHOUT_AUTHORIZATION', 'Remise sans code responsable');
      }
      setError(check.reason || 'Remise refusée');
      return;
    }
    store.setManualDiscount(newTotal, approver.trim());
    store.logScoreEvent(
      'DISCOUNT_WITH_MANAGER_CODE',
      `Remise ${fmt(amountMinor)} (${scope === 'line' && line ? `ligne « ${line.name} »` : 'ticket'}) — motif : ${reason.trim()}`,
    );
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 backdrop-blur-sm animate-fade-in" onClick={onClose}>
      <div className="w-full max-w-md bg-white rounded-3xl shadow-elevated p-7 space-y-5 animate-scale-in" onClick={(e) => e.stopPropagation()}>
        {/* Titre */}
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-bold text-pos-text flex items-center gap-2.5">
            <span className="w-10 h-10 rounded-xl bg-pos-accent/10 flex items-center justify-center">
              <Percent size={18} className="text-pos-accent" />
            </span>
            Remise
          </h3>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-pos-subtle transition-colors"><X size={18} className="text-pos-muted" /></button>
        </div>

        {/* Portée */}
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={() => setScope('ticket')}
            className={`flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-semibold border transition-colors ${scope === 'ticket' ? 'border-pos-accent bg-pos-accent/5 text-pos-accent' : 'border-pos-border text-pos-muted hover:bg-pos-subtle'}`}
          >
            <Receipt size={15} /> Tout le ticket
          </button>
          <button
            onClick={() => setScope('line')}
            disabled={store.cartItems.length === 0}
            className={`flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-semibold border transition-colors disabled:opacity-40 ${scope === 'line' ? 'border-pos-accent bg-pos-accent/5 text-pos-accent' : 'border-pos-border text-pos-muted hover:bg-pos-subtle'}`}
          >
            <ListOrdered size={15} /> Une ligne
          </button>
        </div>

        {/* Sélecteur de ligne */}
        {scope === 'line' && (
          <select
            value={lineId ?? ''}
            onChange={(e) => setLineId(e.target.value)}
            className="w-full px-3.5 py-2.5 rounded-xl border border-pos-border text-sm bg-white focus:outline-none focus:ring-2 focus:ring-pos-accent/20"
          >
            {store.cartItems.map((i) => (
              <option key={i.productId} value={i.productId}>
                {i.name} — {i.quantity} × {fmt(i.unitPriceMinorUnits)}
              </option>
            ))}
          </select>
        )}

        {/* Mode + valeur */}
        <div className="flex gap-2">
          <div className="flex rounded-xl border border-pos-border overflow-hidden">
            <button
              onClick={() => setMode('euro')}
              className={`px-3.5 py-2.5 text-sm font-semibold transition-colors ${mode === 'euro' ? 'bg-pos-text text-white' : 'text-pos-muted hover:bg-pos-subtle'}`}
              title="Remise fixe en euros"
            >
              <Euro size={15} />
            </button>
            <button
              onClick={() => setMode('percent')}
              className={`px-3.5 py-2.5 text-sm font-semibold transition-colors ${mode === 'percent' ? 'bg-pos-text text-white' : 'text-pos-muted hover:bg-pos-subtle'}`}
              title="Remise en pourcentage"
            >
              <Percent size={15} />
            </button>
          </div>
          <input
            type="number" inputMode="decimal" step="0.01" min="0" autoFocus
            value={value} onChange={(e) => { setValue(e.target.value); if (error) setError(null); }}
            placeholder={mode === 'euro' ? 'Montant en €' : '% de remise'}
            className="flex-1 px-4 py-2.5 rounded-xl border border-pos-border text-sm font-semibold tabular-nums focus:outline-none focus:ring-2 focus:ring-pos-accent/20"
          />
        </div>

        {/* Aperçu du montant calculé */}
        <div className="flex items-center justify-between px-4 py-2.5 rounded-xl bg-pos-subtle/70 text-sm">
          <span className="text-pos-muted">Remise appliquée</span>
          <span className="font-bold tabular-nums text-pos-text">{amountMinor > 0 ? `-${fmt(amountMinor)}` : '—'}</span>
        </div>

        {/* Justification + approbation — OBLIGATOIRES */}
        <div className="space-y-2">
          <input
            type="text" value={reason} onChange={(e) => { setReason(e.target.value); if (error) setError(null); }}
            placeholder="Motif de la remise (obligatoire)"
            className="w-full px-4 py-2.5 rounded-xl border border-pos-border text-sm focus:outline-none focus:ring-2 focus:ring-pos-accent/20"
          />
          <div className="relative">
            <ShieldCheck size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-pos-muted/60" />
            <input
              type="text" value={approver} onChange={(e) => { setApprover(e.target.value); if (error) setError(null); }}
              placeholder="Code responsable (obligatoire)"
              className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-pos-border text-sm focus:outline-none focus:ring-2 focus:ring-pos-accent/20"
            />
          </div>
          <p className="text-[11px] text-pos-muted">
            Plafond {MANUAL_DISCOUNT_MAX_PCT}% du sous-total ({fmt(capMinor)}){existing > 0 && <> — remise déjà appliquée : {fmt(existing)}</>}. Le serveur re-valide systématiquement.
          </p>
        </div>

        {error && <p className="text-xs font-medium text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>}

        {/* Actions */}
        <div className="flex gap-2.5 pt-1">
          <button onClick={onClose} className="flex-1 py-3 rounded-xl border border-pos-border text-sm font-semibold text-pos-muted hover:bg-pos-subtle transition-colors">Annuler</button>
          <button
            onClick={apply}
            disabled={amountMinor <= 0 || !reason.trim() || !approver.trim()}
            className="flex-1 py-3 rounded-xl bg-pos-accent hover:bg-pos-accent-deep text-white text-sm font-semibold transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            <Check size={15} /> Appliquer la remise
          </button>
        </div>
      </div>
    </div>
  );
}
