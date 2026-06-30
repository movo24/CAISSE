import React, { useState, useMemo } from 'react';
import { Percent, X, ShieldAlert } from 'lucide-react';

/**
 * POS-054 — manual cashier discount entry.
 * Mirrors the server policy for UX (hard cap 30%, responsable PIN above 20%,
 * written motive mandatory 21-30%). The SERVER is authoritative: it re-verifies
 * the PIN, the cap and the motive and rejects with a clear message.
 */
const HARD_CAP_PCT = 30;
const PIN_THRESHOLD_PCT = 20; // above this, responsable PIN + motive required

interface Props {
  open: boolean;
  subtotalMinorUnits: number;
  current?: { amountMinorUnits: number; reason: string; responsablePin: string } | null;
  onClose: () => void;
  onApply: (d: { amountMinorUnits: number; reason: string; responsablePin: string } | null) => void;
}

export function DiscountModal({ open, subtotalMinorUnits, current, onClose, onApply }: Props) {
  const [mode, setMode] = useState<'amount' | 'pct'>('amount');
  const [value, setValue] = useState(current ? (current.amountMinorUnits / 100).toString() : '');
  const [reason, setReason] = useState(current?.reason ?? '');
  const [pin, setPin] = useState('');

  const amountMinorUnits = useMemo(() => {
    const v = parseFloat((value || '').replace(',', '.'));
    if (!Number.isFinite(v) || v <= 0) return 0;
    if (mode === 'pct') return Math.round(subtotalMinorUnits * Math.min(v, 100) / 100);
    return Math.round(v * 100);
  }, [value, mode, subtotalMinorUnits]);

  const pct = subtotalMinorUnits > 0 ? (amountMinorUnits / subtotalMinorUnits) * 100 : 0;
  const overCap = pct > HARD_CAP_PCT + 1e-9;
  const needsAuth = pct > PIN_THRESHOLD_PCT;
  const motiveOk = !needsAuth || reason.trim().length >= 3;
  const pinOk = !needsAuth || pin.trim().length >= 4;
  const canApply = amountMinorUnits > 0 && amountMinorUnits <= subtotalMinorUnits && !overCap && motiveOk && pinOk;

  if (!open) return null;

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 animate-fade-in">
      <div className="bg-white rounded-2xl w-full max-w-md p-5 shadow-2xl">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold flex items-center gap-2"><Percent className="w-5 h-5 text-indigo-600" /> Remise responsable</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700"><X className="w-5 h-5" /></button>
        </div>

        <div className="inline-flex rounded-lg border overflow-hidden mb-3">
          <button onClick={() => setMode('amount')} className={`px-4 py-1.5 text-sm ${mode === 'amount' ? 'bg-indigo-600 text-white' : 'bg-white'}`}>Montant €</button>
          <button onClick={() => setMode('pct')} className={`px-4 py-1.5 text-sm ${mode === 'pct' ? 'bg-indigo-600 text-white' : 'bg-white'}`}>Pourcentage %</button>
        </div>

        <input
          autoFocus type="number" inputMode="decimal" min="0" value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={mode === 'pct' ? 'ex. 10' : 'ex. 5,00'}
          className="w-full border rounded-lg px-3 py-2 text-lg mb-2"
        />

        <div className="text-sm text-gray-600 mb-3">
          Sous-total : <b>{(subtotalMinorUnits / 100).toFixed(2)} €</b> — Remise : <b>{(amountMinorUnits / 100).toFixed(2)} €</b> ({pct.toFixed(1)} %)
        </div>

        {overCap && (
          <div className="flex items-center gap-2 text-red-600 bg-red-50 border border-red-200 rounded-lg p-2 mb-3 text-sm">
            <ShieldAlert className="w-4 h-4" /> Plafond caisse 30 % dépassé — refusé.
          </div>
        )}

        {needsAuth && !overCap && (
          <div className="space-y-2 mb-3">
            <div className="text-xs text-amber-700">Au-delà de 20 % : PIN responsable + motif obligatoires.</div>
            <input
              type="text" value={reason} onChange={(e) => setReason(e.target.value)}
              placeholder="Motif (obligatoire)"
              className="w-full border rounded-lg px-3 py-2 text-sm"
            />
            <input
              type="password" value={pin} onChange={(e) => setPin(e.target.value)}
              placeholder="PIN responsable"
              className="w-full border rounded-lg px-3 py-2 text-sm"
            />
          </div>
        )}

        <div className="flex gap-2">
          {current && (
            <button onClick={() => { onApply(null); onClose(); }} className="px-4 py-2 text-sm rounded-lg border text-red-600 hover:bg-red-50">Retirer</button>
          )}
          <button onClick={onClose} className="px-4 py-2 text-sm rounded-lg border hover:bg-gray-50 ml-auto">Annuler</button>
          <button
            disabled={!canApply}
            onClick={() => { onApply({ amountMinorUnits, reason: reason.trim(), responsablePin: pin.trim() }); onClose(); }}
            className="px-4 py-2 text-sm rounded-lg bg-indigo-600 text-white disabled:opacity-40"
          >Appliquer</button>
        </div>
      </div>
    </div>
  );
}
