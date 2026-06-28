/**
 * POS-066 — Name normalization for duplicate detection (pure, unit-testable).
 *
 * Normalizes a product/category name so that visually-equivalent names collide:
 *  - Unicode NFD + strip diacritics (Café == Cafe)
 *  - lowercase, trim, collapse internal whitespace.
 *
 * Provided as a foundation for robust anti-doublon. NOT yet wired into the SQL dedup
 * (categories currently use LOWER()=LOWER(); switching to accent-insensitive would change
 * behavior and needs a product decision — see TECHNICAL_DEBT TD-066-NAME-WIRING).
 */

// Combining diacritical marks block U+0300–U+036F.
const DIACRITICS = /[̀-ͯ]/g;

export function normalizeName(name: string): string {
  return name
    .normalize('NFD')
    .replace(DIACRITICS, '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ');
}

/** True if `candidate` normalizes to the same value as any of `existing`. */
export function isDuplicateName(candidate: string, existing: string[]): boolean {
  const n = normalizeName(candidate);
  return existing.some((e) => normalizeName(e) === n);
}
