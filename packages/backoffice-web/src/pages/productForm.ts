/**
 * Construction + validation du payload produit backoffice, aligné STRICTEMENT
 * sur les DTO backend (`CreateProductDto` / `UpdateProductDto`).
 *
 * Invariants (cause du bug R1 — payload ≠ DTO → 400 systématique via
 * `forbidNonWhitelisted`) :
 *  - jamais de `storeId` (le serveur le force depuis le JWT — absent des DTO) ;
 *  - jamais de `ean` en modification (immuable — absent de `UpdateProductDto`) ;
 *  - noms de champs exacts : `priceMinorUnits`, `stockQuantity`, `categoryId`,
 *    `costMinorUnits`, `taxRate` ;
 *  - montants en centimes entiers (euros × 100, arrondis).
 */

/** Statuts backend valides (validés serveur via @IsIn) — pour l'UI des sélecteurs. */
export type ProductStatus = 'draft' | 'pending_validation' | 'active' | 'rejected' | 'archived';

export interface ProductFormValues {
  name: string;
  ean: string;
  price: string; // euros (saisie)
  stock: string;
  category: string;
  description: string;
  cost: string; // euros (saisie)
  taxRate: string; // %
  // Champs enrichis (Lot 1 — colonnes déjà en base, exposées via DTO) :
  sku?: string;
  brandId?: string;
  supplierId?: string;
  status?: string; // l'un de ProductStatus ; validé serveur
  oldPrice?: string; // euros — prix barré / de référence
}

export interface CreateProductPayload {
  ean: string;
  name: string;
  priceMinorUnits: number;
  stockQuantity: number;
  categoryId?: string;
  description?: string;
  costMinorUnits?: number;
  taxRate?: number;
  sku?: string;
  brandId?: string;
  supplierId?: string;
  status?: string;
  oldPriceMinorUnits?: number;
}

export interface UpdateProductPayload {
  name: string;
  priceMinorUnits: number;
  stockQuantity: number;
  categoryId?: string;
  description?: string;
  costMinorUnits?: number;
  taxRate?: number;
  sku?: string;
  brandId?: string | null;
  supplierId?: string | null;
  status?: string;
  oldPriceMinorUnits?: number | null;
  reason?: string;
}

const eurosToCents = (v: string): number => Math.round(parseFloat(v) * 100);

/**
 * Étiquettes produit (P-A / M-A — colonne `tags` jsonb). Conversion UI ↔ payload :
 * l'UI saisit une chaîne « a, b, c » ; le DTO backend attend `string[]`.
 */
export function parseTags(input: string): string[] {
  return input
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);
}

export function formatTags(tags: unknown): string {
  return Array.isArray(tags) ? tags.filter((t): t is string => typeof t === 'string').join(', ') : '';
}

/** Renvoie un message d'erreur, ou null si le formulaire est valide. */
export function validateProductForm(form: ProductFormValues, isEdit: boolean): string | null {
  if (!form.name.trim()) return 'Le nom du produit est obligatoire.';
  if (!isEdit && !form.ean.trim()) return "Le code EAN est obligatoire pour créer un produit.";

  const price = parseFloat(form.price);
  if (form.price.trim() === '' || !Number.isFinite(price) || price < 0) {
    return 'Le prix doit être un nombre positif ou nul.';
  }
  if (form.stock.trim() !== '') {
    const stock = parseInt(form.stock, 10);
    if (!Number.isFinite(stock) || stock < 0) return 'Le stock doit être un entier positif ou nul.';
  }
  if (form.cost.trim() !== '') {
    const cost = parseFloat(form.cost);
    if (!Number.isFinite(cost) || cost < 0) return "Le prix d'achat doit être un nombre positif ou nul.";
  }
  if (form.taxRate.trim() !== '') {
    const t = parseFloat(form.taxRate);
    if (!Number.isFinite(t) || t < 0) return 'La TVA doit être un nombre positif ou nul.';
  }
  if (form.oldPrice !== undefined && form.oldPrice.trim() !== '') {
    const o = parseFloat(form.oldPrice);
    if (!Number.isFinite(o) || o < 0) return 'Le prix barré doit être un nombre positif ou nul.';
  }
  return null;
}

/** Champs optionnels communs create/update (jamais de clé vide envoyée). */
function optionalFields(form: ProductFormValues): Partial<CreateProductPayload> {
  const out: Partial<CreateProductPayload> = {};
  if (form.category.trim()) out.categoryId = form.category.trim();
  if (form.description.trim()) out.description = form.description.trim();
  if (form.cost.trim() !== '') out.costMinorUnits = eurosToCents(form.cost);
  if (form.taxRate.trim() !== '') out.taxRate = parseFloat(form.taxRate);
  // Champs enrichis — émis uniquement s'ils sont renseignés (jamais de clé vide).
  if (form.sku !== undefined && form.sku.trim()) out.sku = form.sku.trim();
  if (form.brandId) out.brandId = form.brandId;
  if (form.supplierId) out.supplierId = form.supplierId;
  if (form.status) out.status = form.status;
  if (form.oldPrice !== undefined && form.oldPrice.trim() !== '') {
    out.oldPriceMinorUnits = eurosToCents(form.oldPrice);
  }
  return out;
}

export function buildCreatePayload(form: ProductFormValues): CreateProductPayload {
  return {
    ean: form.ean.trim(),
    name: form.name.trim(),
    priceMinorUnits: eurosToCents(form.price),
    stockQuantity: form.stock.trim() === '' ? 0 : parseInt(form.stock, 10),
    ...optionalFields(form),
  };
}

export function buildUpdatePayload(form: ProductFormValues, reason?: string): UpdateProductPayload {
  const payload: UpdateProductPayload = {
    name: form.name.trim(),
    priceMinorUnits: eurosToCents(form.price),
    stockQuantity: form.stock.trim() === '' ? 0 : parseInt(form.stock, 10),
    ...optionalFields(form),
  };
  if (reason && reason.trim()) payload.reason = reason.trim();
  return payload;
}
