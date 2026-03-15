import React from 'react';
import { Delete, Check, X } from 'lucide-react';

interface NumericKeypadProps {
  value: string;
  onChange: (value: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
  mode: 'quantity' | 'price' | 'discount' | 'pin';
  label?: string;
}

export function NumericKeypad({ value, onChange, onConfirm, onCancel, mode, label }: NumericKeypadProps) {
  const handleKey = (key: string) => {
    if (key === 'backspace') {
      onChange(value.slice(0, -1));
    } else if (key === ',') {
      if (mode === 'quantity' || mode === 'pin') return; // No decimals for quantity/pin
      if (!value.includes(',')) onChange(value + ',');
    } else {
      // PIN mode: max 4 digits
      if (mode === 'pin' && value.length >= 4) return;
      onChange(value + key);
    }
    // Haptic feedback
    if (navigator.vibrate) navigator.vibrate(10);
  };

  const modeLabels: Record<string, string> = {
    quantity: 'Quantite',
    price: 'Prix (\u20ac)',
    discount: 'Remise (\u20ac)',
    pin: 'Code PIN',
  };

  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', ',', '0', 'backspace'];

  return (
    <div className="bg-white rounded-2xl shadow-elevated border border-pos-border/20 p-4 w-64">
      {/* Label */}
      <p className="text-xs font-semibold text-pos-muted uppercase tracking-wider mb-2 text-center">
        {label || modeLabels[mode]}
      </p>

      {/* Display */}
      <div className="bg-pos-subtle rounded-xl px-4 py-3 mb-3 text-center">
        <span className="text-2xl font-black text-pos-text">
          {mode === 'pin' ? '\u2022'.repeat(value.length) : value || '0'}
        </span>
        {mode === 'price' || mode === 'discount' ? (
          <span className="text-lg text-pos-muted ml-1">{'\u20ac'}</span>
        ) : null}
      </div>

      {/* Keys grid */}
      <div className="grid grid-cols-3 gap-1.5">
        {keys.map((key) => (
          <button
            key={key}
            onClick={() => handleKey(key)}
            className={`flex items-center justify-center rounded-xl font-bold text-lg transition-all product-card-touch ${
              key === 'backspace'
                ? 'bg-red-50 text-red-500 hover:bg-red-100'
                : key === ','
                ? `bg-pos-subtle text-pos-muted ${mode === 'quantity' || mode === 'pin' ? 'opacity-30 cursor-not-allowed' : 'hover:bg-gray-200'}`
                : 'bg-pos-subtle text-pos-text hover:bg-gray-200'
            }`}
            style={{ height: 56 }}
            disabled={key === ',' && (mode === 'quantity' || mode === 'pin')}
          >
            {key === 'backspace' ? <Delete size={20} /> : key}
          </button>
        ))}
      </div>

      {/* Action buttons */}
      <div className="flex gap-2 mt-3">
        <button
          onClick={onCancel}
          className="flex-1 flex items-center justify-center gap-1.5 py-3 rounded-xl bg-pos-subtle text-pos-muted font-semibold text-sm hover:bg-gray-200 transition-colors"
        >
          <X size={16} /> Annuler
        </button>
        <button
          onClick={onConfirm}
          disabled={!value}
          className="flex-1 flex items-center justify-center gap-1.5 py-3 rounded-xl bg-pos-accent text-white font-semibold text-sm hover:bg-pos-accent/90 transition-colors shadow-lg shadow-pos-accent/25 disabled:opacity-40"
        >
          <Check size={16} /> OK
        </button>
      </div>
    </div>
  );
}
