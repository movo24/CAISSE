/**
 * P310 (cycle F, TD-061-UI) — pure builder for the product create/update payload.
 *
 * WHY: the backend runs ValidationPipe { whitelist, forbidNonWhitelisted } —
 * any key outside the DTO (price, stock, category, storeId…) is a 400. The
 * previous inline payload used exactly those keys. This builder emits ONLY
 * DTO-valid keys (products.dto.ts) and converts euros→centimes explicitly.
 */

export interface ProductFormValues {
  name: string;
  ean: string;
  price: string; // euros, operator input ("5,50" tolerated)
  stock: string;
  category: string; // categoryId (uuid) or '' / display fallback
  /** POS-061 — store override in euros; '' = no override (edit sends null to clear). */
  priceOverride?: string;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function eurosToCents(raw: string): number {
  const v = parseFloat((raw || '').replace(',', '.'));
  return Number.isFinite(v) && v > 0 ? Math.round(v * 100) : 0;
}

export function buildProductPayload(
  form: ProductFormValues,
  opts: { editing: boolean },
): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    name: form.name.trim(),
    ean: form.ean.trim(),
    priceMinorUnits: eurosToCents(form.price),
    stockQuantity: Math.max(0, parseInt(form.stock || '0', 10) || 0),
  };
  // category input holds a categoryId when set from the API; only send real ids
  if (form.category && UUID_RE.test(form.category)) payload.categoryId = form.category;

  // POS-061 override: only supported by the UPDATE DTO. Empty string on edit
  // means "clear the override" (explicit null).
  if (opts.editing) {
    const raw = (form.priceOverride ?? '').trim();
    payload.priceOverrideMinorUnits = raw === '' ? null : eurosToCents(raw);
  }
  return payload;
}
