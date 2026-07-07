import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Le motif de remboursement est OBLIGATOIRE côté caisse (pas juste visuel) :
 * les deux chemins (online + offline) bloquent la validation sans motif,
 * envoient `reason` au backend et journalisent REFUND_WITH_REASON.
 */
const src = readFileSync(join(__dirname, 'ReturnModal.tsx'), 'utf8');

describe('ReturnModal — motif de remboursement obligatoire', () => {
  it('bloque la validation quand le motif fait moins de 3 caractères', () => {
    // Présent dans les deux fonctions submit (online + offline).
    const occurrences = src.match(/reason\.trim\(\)\.length < 3/g) || [];
    expect(occurrences.length).toBeGreaterThanOrEqual(2);
  });

  it('désactive le bouton sans motif valide (UI)', () => {
    expect(src).toMatch(/reasonOk/);
    expect(src).toContain('Motif du remboursement');
  });

  it('envoie le motif au backend (online) et via la file (offline)', () => {
    expect(src).toMatch(/reason:\s*reason\.trim\(\)/);
  });

  it('journalise REFUND_WITH_REASON', () => {
    expect(src).toContain('REFUND_WITH_REASON');
  });
});
