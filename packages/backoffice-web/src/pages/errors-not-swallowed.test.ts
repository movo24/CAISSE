/**
 * POS-133 / S5 — les erreurs de chargement ne doivent pas être avalées.
 *
 * Le repo n'a pas d'infra de test de rendu (pas de testing-library, env node) :
 * on pose donc un VERROU SOURCE, même style que les drift-locks backend —
 * si quelqu'un supprime l'affichage de l'erreur, ce test casse en CI.
 *
 * Contrat verrouillé, par page :
 *   1. le catch du chargement alimente un état d'erreur (pas seulement console.*)
 *   2. cet état est effectivement RENDU dans le JSX.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const read = (p: string) => fs.readFileSync(path.join(__dirname, p), 'utf8');

describe('POS-133 — LabelsPage ne masque pas l’échec de chargement produits', () => {
  const src = read('LabelsPage.tsx');

  it('le catch alimente un état d’erreur', () => {
    expect(src).toMatch(/setLoadError\(\s*['"`]/); // message utilisateur, pas null
  });

  it('l’état d’erreur est rendu dans le JSX (pas seulement déclaré)', () => {
    // Référence à `loadError` en dehors de sa déclaration/du setter :
    const uses = (src.match(/(?<!set)(?<![A-Za-z])loadError/g) || []).length;
    expect(uses).toBeGreaterThanOrEqual(2); // déclaration + rendu au minimum
    expect(src).toContain('data-testid="labels-load-error"');
  });
});

describe('POS-133 — StockAlertsPage ne masque pas l’échec de chargement', () => {
  const src = read('StockAlertsPage.tsx');

  it('le catch alimente un état d’erreur rendu dans le JSX', () => {
    expect(src).toMatch(/setError\(\s*['"`]/);
    expect(src).toMatch(/\{error\s*&&/); // rendu conditionnel de l'erreur
  });
});
