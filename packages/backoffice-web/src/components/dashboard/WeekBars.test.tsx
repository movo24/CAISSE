// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import React from 'react';
import { render, screen, cleanup } from '@testing-library/react';
import { WeekBars } from './WeekBars';

/**
 * Régression bug 2026-07-24 — « Semaine en cours » : la barre du vendredi
 * (une vente réelle, moyenne N-1 jamais alimentée = zéro) était rendue à
 * 100 000 % de la zone de tracé et traversait tout le dashboard. Ces tests
 * rendent le VRAI composant avec les données déclencheuses et vérifient que
 * chaque hauteur reste dans [0, 100 %].
 */

const DAYS = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'] as const;

function heightOf(testId: string): number {
  const el = screen.getByTestId(testId);
  return parseFloat((el as HTMLElement).style.height);
}

afterEach(cleanup);

describe('WeekBars — la barre reste TOUJOURS dans sa carte', () => {
  it('données du bug (moyenne N-1 = 0, vente 10 € vendredi) : barre visible, ≤ 100 %', () => {
    render(
      <WeekBars days={DAYS} weekAvg={[0, 0, 0, 0, 0, 0, 0]} weekActual={[0, 0, 0, 0, 1000, 0, 0]} dayIndex={4} />,
    );
    const friday = heightOf('actual-bar-4');
    expect(friday).toBeGreaterThan(90); // bien visible
    expect(friday).toBeLessThanOrEqual(100); // jamais au-delà de la zone
    // Les autres jours ne rendent aucune barre artificielle.
    expect(heightOf('actual-bar-0')).toBe(0);
    // Aucun « 0 % » mensonger affiché quand la référence N-1 est vide.
    expect(screen.queryByText(/%$/)).toBeNull();
  });

  it('toutes les hauteurs sont bornées [0, 100] même avec des valeurs corrompues', () => {
    render(
      <WeekBars
        days={DAYS}
        weekAvg={[NaN, Infinity, -5, '200', null, 0, 0] as unknown[]}
        weekActual={[Infinity, '1000', -1, NaN, 50, 0, 0] as unknown[]}
        dayIndex={6}
      />,
    );
    for (let i = 0; i < 7; i++) {
      const avg = heightOf(`avg-bar-${i}`);
      expect(avg).toBeGreaterThanOrEqual(0);
      expect(avg).toBeLessThanOrEqual(100);
      const actual = heightOf(`actual-bar-${i}`);
      expect(actual).toBeGreaterThanOrEqual(0);
      expect(actual).toBeLessThanOrEqual(100);
    }
  });

  it('semaine entièrement à zéro → état vide propre, aucune barre', () => {
    render(<WeekBars days={DAYS} weekAvg={[0, 0, 0, 0, 0, 0, 0]} weekActual={[0, 0, 0, 0, 0, 0, 0]} dayIndex={2} />);
    expect(screen.getByTestId('week-empty')).toBeTruthy();
    expect(screen.queryByTestId('week-bars')).toBeNull();
  });

  it('références N-1 présentes : proportions et % affichés cohérents', () => {
    render(
      <WeekBars days={DAYS} weekAvg={[1000, 2000, 0, 0, 0, 0, 0]} weekActual={[500, 3000, 0, 0, 0, 0, 0]} dayIndex={1} />,
    );
    // Mardi réalisé 3000 = max → ~95 % (headroom) ; lundi 500 → ~6× moins.
    const tue = heightOf('actual-bar-1');
    const mon = heightOf('actual-bar-0');
    expect(tue).toBeGreaterThan(90);
    expect(tue).toBeLessThanOrEqual(100);
    expect(mon).toBeCloseTo(tue / 6, 0);
    // % vs N-1 affichés : 50 % (lundi) et 150 % (mardi).
    expect(screen.getByText('50%')).toBeTruthy();
    expect(screen.getByText('150%')).toBeTruthy();
  });

  it('le conteneur des barres coupe tout débordement résiduel (overflow-hidden)', () => {
    render(
      <WeekBars days={DAYS} weekAvg={[0, 0, 0, 0, 0, 0, 0]} weekActual={[0, 0, 0, 0, 1000, 0, 0]} dayIndex={4} />,
    );
    expect(screen.getByTestId('week-bars').className).toContain('overflow-hidden');
  });
});
