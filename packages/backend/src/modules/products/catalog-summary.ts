/**
 * Cycle T — synthèse catalogue LECTURE SEULE (cockpit back-office).
 * Pur : reçoit les listes déjà chargées (tenant-scoped par l'appelant),
 * ne mute rien, ne décide rien — il constate.
 *
 * Anomalies détectées (constat, pas de correction automatique) :
 *  - orphan_variant        : parentProductId pointe un produit absent/inconnu ;
 *  - variant_of_variant    : parent qui est lui-même une variante (défensif —
 *                            l'écriture le refuse depuis le Cycle P, mais les
 *                            données antérieures peuvent en contenir) ;
 *  - inactive_supplier_ref : produit ACTIF référençant un fournisseur désactivé
 *                            (référence légale conservée, mais à signaler) ;
 *  - unknown_supplier_ref  : supplierId ne correspond à aucun fournisseur du
 *                            magasin (données antérieures au Cycle P) ;
 *  - price_zero            : produit actif à 0 centime (souvent une erreur de saisie).
 */

export interface SummarizableProduct {
  id: string;
  ean: string;
  name: string;
  priceMinorUnits: number;
  isActive: boolean;
  brand?: string | null;
  supplierId?: string | null;
  parentProductId?: string | null;
}

export interface SummarizableSupplier {
  id: string;
  name: string;
  isActive: boolean;
}

export interface CatalogAnomaly {
  kind:
    | 'orphan_variant'
    | 'variant_of_variant'
    | 'inactive_supplier_ref'
    | 'unknown_supplier_ref'
    | 'price_zero';
  productId: string;
  ean: string;
  name: string;
  detail: string;
}

export interface CatalogSummary {
  totals: {
    products: number;
    active: number;
    inactive: number;
    parents: number;
    variants: number;
    simples: number;
    withSupplier: number;
    brands: number;
    suppliersActive: number;
    suppliersInactive: number;
  };
  anomalies: CatalogAnomaly[];
}

export function buildCatalogSummary(
  products: SummarizableProduct[],
  suppliers: SummarizableSupplier[],
): CatalogSummary {
  const byId = new Map(products.map((p) => [p.id, p]));
  const parentIds = new Set(
    products.filter((p) => p.parentProductId).map((p) => p.parentProductId as string),
  );
  const supplierById = new Map(suppliers.map((s) => [s.id, s]));

  const anomalies: CatalogAnomaly[] = [];
  let active = 0;
  let parents = 0;
  let variants = 0;
  let withSupplier = 0;
  const brands = new Set<string>();

  for (const p of products) {
    if (p.isActive) active++;
    const brand = (p.brand ?? '').trim();
    if (brand) brands.add(brand);

    if (p.parentProductId) {
      variants++;
      const parent = byId.get(p.parentProductId);
      if (!parent) {
        anomalies.push({
          kind: 'orphan_variant', productId: p.id, ean: p.ean, name: p.name,
          detail: `parent ${p.parentProductId} introuvable dans le magasin`,
        });
      } else if (parent.parentProductId) {
        anomalies.push({
          kind: 'variant_of_variant', productId: p.id, ean: p.ean, name: p.name,
          detail: `le parent « ${parent.name} » est lui-même une variante`,
        });
      }
    } else if (parentIds.has(p.id)) {
      parents++;
    }

    if (p.supplierId) {
      withSupplier++;
      const s = supplierById.get(p.supplierId);
      if (!s) {
        anomalies.push({
          kind: 'unknown_supplier_ref', productId: p.id, ean: p.ean, name: p.name,
          detail: `supplierId ${p.supplierId} ne correspond à aucun fournisseur du magasin`,
        });
      } else if (!s.isActive && p.isActive) {
        anomalies.push({
          kind: 'inactive_supplier_ref', productId: p.id, ean: p.ean, name: p.name,
          detail: `fournisseur « ${s.name} » désactivé`,
        });
      }
    }

    if (p.isActive && p.priceMinorUnits === 0) {
      anomalies.push({
        kind: 'price_zero', productId: p.id, ean: p.ean, name: p.name,
        detail: 'prix à 0 centime sur un produit actif',
      });
    }
  }

  return {
    totals: {
      products: products.length,
      active,
      inactive: products.length - active,
      parents,
      variants,
      simples: products.length - parents - variants,
      withSupplier,
      brands: brands.size,
      suppliersActive: suppliers.filter((s) => s.isActive).length,
      suppliersInactive: suppliers.filter((s) => !s.isActive).length,
    },
    anomalies,
  };
}
