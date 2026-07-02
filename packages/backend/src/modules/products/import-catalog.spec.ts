/** Cycle R — validation pure des lignes d'import catalogue. */
import { validateImportRows, ImportValidationContext } from './import-catalog';

const ctx = (over: Partial<ImportValidationContext> = {}): ImportValidationContext => ({
  existingEans: new Set(),
  existingNormalizedNames: new Set(),
  suppliersByName: new Map(),
  ...over,
});

const row = (o: Record<string, unknown>) => ({ priceMinorUnits: 100, ...o });

describe('validateImportRows (pur)', () => {
  it('accepte une ligne complète et applique les défauts (stock 0, champs optionnels null)', () => {
    const r = validateImportRows([row({ name: ' Cola ', ean: ' 123 ' })], ctx());
    expect(r.errors).toEqual([]);
    expect(r.valid).toEqual([
      expect.objectContaining({
        line: 1, name: 'Cola', ean: '123', priceMinorUnits: 100,
        stockQuantity: 0, category: null, brand: null, variantLabel: null, supplierId: null,
      }),
    ]);
  });

  it('refuse nom/EAN manquants et prix non entier/négatif/float', () => {
    const r = validateImportRows(
      [
        row({ ean: '1' }), // nom manquant
        row({ name: 'X' }), // ean manquant
        row({ name: 'Y', ean: '2', priceMinorUnits: 9.99 }), // float interdit (centimes!)
        row({ name: 'Z', ean: '3', priceMinorUnits: -5 }),
      ],
      ctx(),
    );
    expect(r.valid).toEqual([]);
    expect(r.errors.map((e) => e.line)).toEqual([1, 2, 3, 4]);
  });

  it('détecte les doublons EAN et nom équivalent DANS le fichier (première occurrence gardée)', () => {
    const r = validateImportRows(
      [
        row({ name: 'Fraise Tagada', ean: 'A' }),
        row({ name: 'Autre', ean: 'A' }), // EAN dupliqué
        row({ name: 'fraise  TAGADA', ean: 'B' }), // nom équivalent (normalisé)
      ],
      ctx(),
    );
    expect(r.valid.map((v) => v.ean)).toEqual(['A']);
    expect(r.errors).toEqual([
      expect.objectContaining({ line: 2, reason: 'EAN dupliqué dans le fichier' }),
      expect.objectContaining({ line: 3, reason: 'nom équivalent dupliqué dans le fichier' }),
    ]);
  });

  it('refuse EAN/nom déjà présents dans le magasin', () => {
    const r = validateImportRows(
      [row({ name: 'Nouveau', ean: 'EXIST' }), row({ name: 'Réglisse Géante', ean: 'NEW' })],
      ctx({
        existingEans: new Set(['EXIST']),
        existingNormalizedNames: new Set(['reglisse geante']),
      }),
    );
    expect(r.valid).toEqual([]);
    expect(r.errors[0].reason).toContain('EAN déjà présent');
    expect(r.errors[1].reason).toContain('nom équivalent existe déjà');
  });

  it('résout le fournisseur par nom (insensible à la casse) et refuse un fournisseur inconnu', () => {
    const c = ctx({ suppliersByName: new Map([['haribo', 'sup-1']]) });
    const ok = validateImportRows([row({ name: 'A', ean: '1', supplierName: ' HARIBO ' })], c);
    expect(ok.valid[0].supplierId).toBe('sup-1');

    const ko = validateImportRows([row({ name: 'B', ean: '2', supplierName: 'Inconnu SARL' })], c);
    expect(ko.valid).toEqual([]);
    expect(ko.errors[0].reason).toContain('fournisseur inconnu');
  });
});
