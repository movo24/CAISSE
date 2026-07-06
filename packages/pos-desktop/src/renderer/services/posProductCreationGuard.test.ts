import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * Garde anti-régression — règle métier fondamentale :
 * un produit ne doit JAMAIS être créé depuis l'écran caisse.
 *
 * La caisse peut détecter un produit inconnu et créer une DEMANDE
 * d'intégration (`productIntegrationApi.createRequest`), mais aucun code du
 * renderer POS ne doit appeler la création produit (`productsApi.create`).
 */

const RENDERER_ROOT = join(__dirname, '..');

function listSources(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      out.push(...listSources(full));
    } else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) {
      out.push(full);
    }
  }
  return out;
}

describe('POS caisse — interdiction de créer un produit', () => {
  const sources = listSources(RENDERER_ROOT);

  it('aucun appel à productsApi.create dans le renderer POS (hors définition api.ts)', () => {
    const offenders: string[] = [];
    for (const file of sources) {
      const rel = relative(RENDERER_ROOT, file);
      if (rel === join('services', 'api.ts')) continue; // la définition, pas un appel
      const content = readFileSync(file, 'utf8');
      if (content.includes('productsApi.create(')) offenders.push(rel);
    }
    expect(offenders).toEqual([]);
  });

  it("l'écran caisse envoie une demande d'intégration pour un produit inconnu", () => {
    const posPage = readFileSync(join(RENDERER_ROOT, 'pages', 'POSPage.tsx'), 'utf8');
    const useCart = readFileSync(join(RENDERER_ROOT, 'hooks', 'useCart.ts'), 'utf8');

    expect(posPage).toContain('productIntegrationApi.createRequest');
    expect(posPage).toContain('Produit inconnu');
    expect(useCart).toContain('productIntegrationApi.createRequest');
    // La demande caisse est marquée source: 'pos' (jamais une création directe)
    expect(useCart).toContain("source: 'pos'");
  });

  it('la demande caisse ne transporte jamais un statut produit actif', () => {
    const api = readFileSync(join(RENDERER_ROOT, 'services', 'api.ts'), 'utf8');
    const block = api.slice(api.indexOf('productIntegrationApi'));
    const endpoint = block.slice(0, block.indexOf('};'));
    // Le client caisse n'expose que la création de demande — aucun champ
    // status/activate, aucun POST vers /products.
    expect(endpoint).toContain("'/product-integration/requests'");
    expect(endpoint).not.toContain('activate');
    expect(endpoint).not.toContain("post('/products'");
  });
});
