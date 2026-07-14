// ── Sélecteur de période (13 presets + personnalisée) ────────────
// État global léger (zustand) : la période choisie s'applique à tous
// les écrans d'analyse. La période personnalisée prend date de début
// et date de fin (fin incluse).
// ─────────────────────────────────────────────────────────────────

import { useState } from 'react';
import { create } from 'zustand';
import { CalendarRange, ChevronDown } from 'lucide-react';
import {
  PERIOD_LABELS,
  PERIOD_ORDER,
  PeriodKey,
  PeriodWindow,
  periodParams,
  periodWindow,
} from '../lib/periods';

interface PeriodState {
  key: PeriodKey;
  custom: PeriodWindow | null;
  setPeriod: (key: PeriodKey, custom?: PeriodWindow) => void;
}

export const usePeriodStore = create<PeriodState>((set) => ({
  key: 'today',
  custom: null,
  setPeriod: (key, custom) => set({ key, custom: custom ?? null }),
}));

/** Params API de la période courante (recalculés à chaque rendu — pas de now figé). */
export function useCurrentPeriodParams(): { from: string; to: string; tz: string; label: string } {
  const { key, custom } = usePeriodStore();
  const win = periodWindow(key, new Date(), custom ?? undefined);
  return { ...periodParams(win), label: PERIOD_LABELS[key] };
}

const toInputDate = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export function PeriodPicker() {
  const { key, custom, setPeriod } = usePeriodStore();
  const [open, setOpen] = useState(false);
  const [draftFrom, setDraftFrom] = useState('');
  const [draftTo, setDraftTo] = useState('');

  const label =
    key === 'custom' && custom
      ? `${custom.from.toLocaleDateString('fr-FR')} → ${custom.to.toLocaleDateString('fr-FR')}`
      : PERIOD_LABELS[key];

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-mobile-card shadow-soft text-xs font-semibold text-mobile-text"
        aria-label="Changer la période"
      >
        <CalendarRange size={13} className="text-mobile-accent" />
        {label}
        <ChevronDown size={13} className="text-mobile-muted" />
      </button>

      {open && (
        <div className="fixed inset-0 z-40 flex items-end" onClick={() => setOpen(false)}>
          <div className="absolute inset-0 bg-black/30" />
          <div
            className="relative w-full bg-white rounded-t-3xl p-4 pb-8 animate-slide-up max-h-[80dvh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="w-10 h-1 bg-mobile-border rounded-full mx-auto mb-3" />
            <h3 className="text-sm font-bold mb-3">Période d'analyse</h3>
            <div className="grid grid-cols-2 gap-2">
              {PERIOD_ORDER.filter((k) => k !== 'custom').map((k) => (
                <button
                  key={k}
                  onClick={() => {
                    setPeriod(k);
                    setOpen(false);
                  }}
                  className={`px-3 py-2.5 rounded-xl text-sm font-semibold text-left ${
                    key === k ? 'bg-mobile-accent text-white' : 'bg-mobile-subtle text-mobile-text'
                  }`}
                >
                  {PERIOD_LABELS[k]}
                </button>
              ))}
            </div>
            <div className="mt-4 p-3 rounded-xl bg-mobile-subtle space-y-2">
              <p className="text-xs font-bold">Période personnalisée</p>
              <div className="flex items-center gap-2">
                <label className="flex-1 text-[11px] text-mobile-muted">
                  Début
                  <input
                    type="date"
                    value={draftFrom}
                    max={toInputDate(new Date())}
                    onChange={(e) => setDraftFrom(e.target.value)}
                    className="mt-0.5 w-full px-2 py-2 rounded-lg border border-mobile-border bg-white text-sm text-mobile-text"
                  />
                </label>
                <label className="flex-1 text-[11px] text-mobile-muted">
                  Fin (incluse)
                  <input
                    type="date"
                    value={draftTo}
                    max={toInputDate(new Date())}
                    onChange={(e) => setDraftTo(e.target.value)}
                    className="mt-0.5 w-full px-2 py-2 rounded-lg border border-mobile-border bg-white text-sm text-mobile-text"
                  />
                </label>
              </div>
              <button
                disabled={!draftFrom || !draftTo || draftTo < draftFrom}
                onClick={() => {
                  setPeriod('custom', {
                    from: new Date(`${draftFrom}T00:00:00`),
                    to: new Date(`${draftTo}T00:00:00`),
                  });
                  setOpen(false);
                }}
                className="w-full py-2.5 rounded-xl bg-mobile-accent text-white text-sm font-bold disabled:opacity-40"
              >
                Appliquer
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
