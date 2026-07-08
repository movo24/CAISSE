import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * PR #29 — onboarding catalogue magasin : l'import CSV backend (validé, rapport
 * par ligne) a enfin une UI. Invariants source sur ProductsPage.
 */
const src = readFileSync(join(__dirname, '..', 'pages', 'ProductsPage.tsx'), 'utf8');

describe('ProductsPage — import CSV catalogue (source)', () => {
  it('the import goes through the SERVER endpoint (per-row validation), not a client parse', () => {
    expect(src).toMatch(/productsApi\.importCsv\(csv\)/);
  });

  it('the honest per-row report is displayed (created/updated/skipped + error lines)', () => {
    expect(src).toMatch(/Rapport d'import catalogue/);
    expect(src).toMatch(/importReport\.created/);
    expect(src).toMatch(/importReport\.updated/);
    expect(src).toMatch(/importReport\.skipped/);
    expect(src).toMatch(/importReport\.errors\.map/);
  });

  it('the catalogue list is refreshed after import (UI reflects the real state)', () => {
    expect(src).toMatch(/await fetchProducts\(\); \/\/ le catalogue affiché reflète l'état réel post-import/);
  });

  it('a round-trippable server template/export is downloadable', () => {
    expect(src).toMatch(/productsApi\.exportCsv\(\)/);
    expect(src).toMatch(/catalogue-import-/);
  });

  it('import failures surface to the user (no silent catch)', () => {
    expect(src).toMatch(/setImportError\(err\?\.response\?\.data\?\.message/);
  });
});
