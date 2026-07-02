/** Cycle T — synthèse catalogue lecture seule (pur). */
import { buildCatalogSummary, SummarizableProduct, SummarizableSupplier } from './catalog-summary';

const P = (o: Partial<SummarizableProduct> & { id: string; name: string }): SummarizableProduct => ({
  ean: `E-${o.id}`, priceMinorUnits: 100, isActive: true, ...o,
});
const S = (o: Partial<SummarizableSupplier> & { id: string; name: string }): SummarizableSupplier => ({
  isActive: true, ...o,
});

describe('buildCatalogSummary (pur, read-only)', () => {
  it('compte parents/variantes/simples, marques, fournisseurs — cas sain sans anomalie', () => {
    const products = [
      P({ id: 'p1', name: 'Cola', brand: 'Wesley' }),
      P({ id: 'v1', name: 'Cola 33cl', parentProductId: 'p1', supplierId: 's1' }),
      P({ id: 'v2', name: 'Cola 1L', parentProductId: 'p1', brand: ' Wesley ' }),
      P({ id: 'x1', name: 'Réglisse', brand: 'Haribo', isActive: false }),
    ];
    const { totals, anomalies } = buildCatalogSummary(products, [S({ id: 's1', name: 'Four' })]);
    expect(anomalies).toEqual([]);
    expect(totals).toEqual({
      products: 4, active: 3, inactive: 1,
      parents: 1, variants: 2, simples: 1,
      withSupplier: 1, brands: 2, // 'Wesley' trimé = même marque
      suppliersActive: 1, suppliersInactive: 0,
    });
  });

  it('signale variante orpheline et variante-de-variante (données antérieures au Cycle P)', () => {
    const products = [
      P({ id: 'p1', name: 'Parent' }),
      P({ id: 'v1', name: 'Var OK', parentProductId: 'p1' }),
      P({ id: 'vv', name: 'Var de Var', parentProductId: 'v1' }),
      P({ id: 'o1', name: 'Orpheline', parentProductId: 'absent' }),
    ];
    const { anomalies } = buildCatalogSummary(products, []);
    expect(anomalies.map((a) => [a.kind, a.productId])).toEqual([
      ['variant_of_variant', 'vv'],
      ['orphan_variant', 'o1'],
    ]);
  });

  it('signale fournisseur désactivé (produit actif seulement) et fournisseur inconnu', () => {
    const products = [
      P({ id: 'a', name: 'A', supplierId: 'dead' }),
      P({ id: 'b', name: 'B', supplierId: 'dead', isActive: false }), // inactif → pas signalé
      P({ id: 'c', name: 'C', supplierId: 'ghost' }),
    ];
    const { anomalies } = buildCatalogSummary(products, [S({ id: 'dead', name: 'Sortant', isActive: false })]);
    expect(anomalies.map((a) => [a.kind, a.productId])).toEqual([
      ['inactive_supplier_ref', 'a'],
      ['unknown_supplier_ref', 'c'],
    ]);
  });

  it('signale un prix à 0 centime sur produit actif uniquement', () => {
    const { anomalies } = buildCatalogSummary(
      [P({ id: 'z', name: 'Gratuit?', priceMinorUnits: 0 }), P({ id: 'r', name: 'Retiré', priceMinorUnits: 0, isActive: false })],
      [],
    );
    expect(anomalies).toEqual([expect.objectContaining({ kind: 'price_zero', productId: 'z' })]);
  });
});
