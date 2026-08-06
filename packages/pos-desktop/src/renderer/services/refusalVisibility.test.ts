import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * UN REFUS INVISIBLE EST UN BUG.
 *
 * `tenderError` et `failedCount` étaient calculés mais affichés nulle part :
 * un titre-resto au-dessus du reste dû laissait le bouton paraître inerte, et
 * une vente rejetée à la synchronisation disparaissait sans trace à l'écran.
 * Ces gardes empêchent le retour au silence.
 */
const ipad = readFileSync(join(__dirname, '..', 'components', 'ipad', 'IPadPOSLayout.tsx'), 'utf8');
const hook = readFileSync(join(__dirname, '..', 'hooks', 'useOfflineMode.ts'), 'utf8');

describe('refus de tender visible', () => {
  it('le message de refus est rendu dans la modale de paiement', () => {
    expect(ipad).toMatch(/payment\.tenderError &&/);
  });

  it('il est rendu en rouge, pas en texte discret', () => {
    expect(ipad).toMatch(/payment\.tenderError &&[\s\S]{0,400}text-red-700/);
  });
});

describe('ventes refusées visibles', () => {
  it('`failedCount` est exposé par le hook hors ligne', () => {
    expect(hook).toMatch(/failedCount: offline\.failedCount/);
  });

  it('un bandeau est rendu dès qu’une vente est en échec', () => {
    expect(ipad).toMatch(/offlineMode\.failedCount > 0 &&/);
  });

  it('le bandeau est PERMANENT — hors du bloc conditionné au mode hors ligne', () => {
    const banner = ipad.indexOf('offlineMode.failedCount > 0');
    const offlineBlock = ipad.indexOf('{offlineMode.pendingCount} en attente');
    // Le bandeau d'échec vient APRÈS le bloc hors-ligne, donc n'en dépend pas.
    expect(banner).toBeGreaterThan(offlineBlock);
  });

  it('il nomme l’action attendue (reprise manuelle)', () => {
    expect(ipad).toMatch(/reprise manuelle nécessaire/i);
  });
});
