import React, { useState, useMemo } from 'react';
import { Percent, X, ShieldAlert } from 'lucide-react';
import { computeDiscountAmount, evaluateDiscountEntry } from '../../lib/discount-entry-policy';

/**
 * POS-054 — manual cashier discount entry.
 * Validation extracted to lib/discount-entry-policy.ts (P303) and ALIGNED with
 * the server: hard cap 30%, responsable PIN for ANY discount > 0%, written
 * motive from 21%. The SERVER stays authoritative and re-verifies everything.
 */

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

  const amountMinorUnits = useMemo(
    () => computeDiscountAmount(mode, value, subtotalMinorUnits),
    [value, mode, subtotalMinorUnits],
  );

  const { pct, overCap, needsPin, needsMotive, canApply } = useMemo(
    () => evaluateDiscountEntry({ amountMinorUnits, subtotalMinorUnits, reason, pin }),
    [amountMinorUnits, subtotalMinorUnits, reason, pin],
  );

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

        {needsPin && !overCap && (
          <div className="space-y-2 mb-3">
            <div className="text-xs text-amber-700">
              {needsMotive
                ? 'À partir de 21 % : PIN responsable + motif écrit obligatoires.'
                : 'Toute remise manuelle nécessite le PIN d’un responsable.'}
            </div>
            {needsMotive && (
              <input
                type="text" value={reason} onChange={(e) => setReason(e.target.value)}
                placeholder="Motif (obligatoire)"
                className="w-full border rounded-lg px-3 py-2 text-sm"
              />
            )}
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
