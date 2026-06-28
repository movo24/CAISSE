/**
 * POS — EAN-13 barcode helpers (pure, unit-testable).
 * Extracted from ProductsService.generateBarcode (behavior-preserving):
 * the GS1 mod-10 check digit (odd positions ×1, even positions ×3) and
 * internal-barcode assembly (prefix 290 + 9 digits + check digit).
 */

/** GS1 mod-10 check digit for a 12-digit numeric string. */
export function ean13CheckDigit(twelveDigits: string): number {
  if (!/^\d{12}$/.test(twelveDigits)) {
    throw new Error('ean13CheckDigit expects exactly 12 digits');
  }
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    // index 0,2,4… weight 1 ; index 1,3,5… weight 3 (matches legacy generateBarcode)
    sum += parseInt(twelveDigits[i], 10) * (i % 2 === 0 ? 1 : 3);
  }
  return (10 - (sum % 10)) % 10;
}

/** True when `ean` is a syntactically valid EAN-13 (13 digits, correct check digit). */
export function isValidEan13(ean: string | null | undefined): boolean {
  if (typeof ean !== 'string' || !/^\d{13}$/.test(ean)) return false;
  return ean13CheckDigit(ean.slice(0, 12)) === parseInt(ean[12], 10);
}

/**
 * Build a full EAN-13 from a 12-digit partial by appending the check digit.
 * The caller is responsible for the partial (e.g. `290` + 9 random digits).
 */
export function buildEan13(twelveDigits: string): string {
  return `${twelveDigits}${ean13CheckDigit(twelveDigits)}`;
}

/** Prefix used for CAISSE internal (generated, non-supplier) barcodes. */
export const INTERNAL_EAN_PREFIX = '290';

/** True when an EAN is one of our generated internal barcodes (prefix 290). */
export function isInternalEan(ean: string | null | undefined): boolean {
  return typeof ean === 'string' && ean.startsWith(INTERNAL_EAN_PREFIX);
}
