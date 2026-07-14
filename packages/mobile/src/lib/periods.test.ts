// P366 — fenêtres de période du centre de pilotage (pur).
// Verrouille : bornes exactes des 13 presets, semaine ISO (lundi),
// semestres calendaires, période personnalisée fin incluse.

import { describe, expect, it } from 'vitest';
import { periodParams, periodWindow } from './periods';

// Mardi 14 juillet 2026, 15:30 heure locale.
const NOW = new Date(2026, 6, 14, 15, 30, 0);

const d = (y: number, m: number, day: number) => new Date(y, m - 1, day).getTime();

describe('periodWindow', () => {
  it("aujourd'hui / hier : journées locales complètes", () => {
    const today = periodWindow('today', NOW);
    expect(today.from.getTime()).toBe(d(2026, 7, 14));
    expect(today.to.getTime()).toBe(d(2026, 7, 15));
    const yesterday = periodWindow('yesterday', NOW);
    expect(yesterday.from.getTime()).toBe(d(2026, 7, 13));
    expect(yesterday.to.getTime()).toBe(d(2026, 7, 14));
  });

  it('semaines ISO : lundi → borne exclusive', () => {
    const week = periodWindow('this_week', NOW);
    expect(week.from.getTime()).toBe(d(2026, 7, 13)); // lundi 13/07
    const lastWeek = periodWindow('last_week', NOW);
    expect(lastWeek.from.getTime()).toBe(d(2026, 7, 6));
    expect(lastWeek.to.getTime()).toBe(d(2026, 7, 13));
  });

  it('mois courant / précédent', () => {
    expect(periodWindow('this_month', NOW).from.getTime()).toBe(d(2026, 7, 1));
    const lm = periodWindow('last_month', NOW);
    expect(lm.from.getTime()).toBe(d(2026, 6, 1));
    expect(lm.to.getTime()).toBe(d(2026, 7, 1));
  });

  it('semestres calendaires (S2 commence le 1er juillet)', () => {
    const cur = periodWindow('this_semester', NOW);
    expect(cur.from.getTime()).toBe(d(2026, 7, 1));
    const prev = periodWindow('last_semester', NOW);
    expect(prev.from.getTime()).toBe(d(2026, 1, 1));
    expect(prev.to.getTime()).toBe(d(2026, 7, 1));
  });

  it('années : courante / précédente', () => {
    expect(periodWindow('this_year', NOW).from.getTime()).toBe(d(2026, 1, 1));
    const ly = periodWindow('last_year', NOW);
    expect(ly.from.getTime()).toBe(d(2025, 1, 1));
    expect(ly.to.getTime()).toBe(d(2026, 1, 1));
  });

  it('personnalisée : date de fin INCLUSE (borne exclusive = fin + 1 jour)', () => {
    const w = periodWindow('custom', NOW, {
      from: new Date(2026, 5, 1),
      to: new Date(2026, 5, 10),
    });
    expect(w.from.getTime()).toBe(d(2026, 6, 1));
    expect(w.to.getTime()).toBe(d(2026, 6, 11));
  });

  it('personnalisée sans bornes : erreur explicite (pas de fenêtre inventée)', () => {
    expect(() => periodWindow('custom', NOW)).toThrow(/personnalisée/);
  });

  it('les périodes « en cours » ne débordent jamais dans le futur au-delà de demain 00:00', () => {
    for (const key of ['today', 'this_week', 'this_month', 'this_semester', 'this_year'] as const) {
      expect(periodWindow(key, NOW).to.getTime()).toBe(d(2026, 7, 15));
    }
  });
});

describe('periodParams', () => {
  it('sérialise en ISO + fuseau de l’appareil', () => {
    const p = periodParams(periodWindow('yesterday', NOW));
    expect(new Date(p.from).getTime()).toBe(d(2026, 7, 13));
    expect(new Date(p.to).getTime()).toBe(d(2026, 7, 14));
    expect(p.tz.length).toBeGreaterThan(0);
  });
});
