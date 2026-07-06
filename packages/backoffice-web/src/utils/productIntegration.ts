/**
 * Intégration produit — helpers purs (testables) pour le formulaire
 * "Nouvelle fiche produit" issu d'un scan de code-barres inconnu.
 */

export interface ProductIntegrationForm {
  ean: string;
  name: string;
  brandName: string;
  categoryId: string;
  supplierName: string;
  /** Prix d'achat en euros, saisie libre ("2,50"). */
  costEuros: string;
  /** Prix de vente en euros, saisie libre. */
  priceEuros: string;
  taxRate: string;
  unitType: string;
  imageUrl: string;
  initialStock: string;
  sku: string;
}

export const EMPTY_INTEGRATION_FORM: ProductIntegrationForm = {
  ean: '',
  name: '',
  brandName: '',
  categoryId: '',
  supplierName: '',
  costEuros: '',
  priceEuros: '',
  taxRate: '20',
  unitType: 'unit',
  imageUrl: '',
  initialStock: '0',
  sku: '',
};

/** "2,50" | "2.5" | " 3 " → centimes (int), null si invalide/vide. */
export function eurosToMinorUnits(input: string): number | null {
  const clean = (input || '').trim().replace(',', '.');
  if (!clean) return null;
  const value = Number(clean);
  if (!Number.isFinite(value) || value < 0) return null;
  return Math.round(value * 100);
}

export interface ProductPayloadResult {
  payload: Record<string, unknown> | null;
  errors: string[];
}

/**
 * Transforme le formulaire en payload API `POST /product-integration/products`.
 * Valide : code-barres, nom, prix de vente. Retourne les erreurs bloquantes.
 */
export function buildProductPayload(
  form: ProductIntegrationForm,
  opts: { activate: boolean; pin?: string; requestId?: string },
): ProductPayloadResult {
  const errors: string[] = [];

  const ean = form.ean.trim();
  if (!ean) errors.push('Le code-barres est requis.');

  const name = form.name.trim();
  if (!name) errors.push('Le nom du produit est requis.');

  const priceMinorUnits = eurosToMinorUnits(form.priceEuros);
  if (priceMinorUnits == null) errors.push('Prix de vente invalide.');

  const costMinorUnits = form.costEuros.trim() ? eurosToMinorUnits(form.costEuros) : undefined;
  if (form.costEuros.trim() && costMinorUnits == null) errors.push("Prix d'achat invalide.");

  const taxRate = form.taxRate.trim() ? Number(form.taxRate.replace(',', '.')) : undefined;
  if (taxRate != null && (!Number.isFinite(taxRate) || taxRate < 0)) {
    errors.push('Taux de TVA invalide.');
  }

  const initialStock = form.initialStock.trim() ? Number(form.initialStock) : 0;
  if (!Number.isInteger(initialStock) || initialStock < 0) {
    errors.push('Stock initial invalide.');
  }

  if (errors.length > 0) return { payload: null, errors };

  return {
    payload: {
      ean,
      name,
      priceMinorUnits,
      ...(costMinorUnits != null ? { costMinorUnits } : {}),
      ...(taxRate != null ? { taxRate } : {}),
      unitType: form.unitType || 'unit',
      ...(form.categoryId ? { categoryId: form.categoryId } : {}),
      ...(form.brandName.trim() ? { brandName: form.brandName.trim() } : {}),
      ...(form.supplierName.trim() ? { supplierName: form.supplierName.trim() } : {}),
      ...(form.imageUrl.trim() ? { imageUrl: form.imageUrl.trim() } : {}),
      ...(form.sku.trim() ? { sku: form.sku.trim() } : {}),
      stockQuantity: initialStock,
      activate: opts.activate,
      ...(opts.pin ? { pin: opts.pin } : {}),
      ...(opts.requestId ? { requestId: opts.requestId } : {}),
    },
    errors: [],
  };
}
