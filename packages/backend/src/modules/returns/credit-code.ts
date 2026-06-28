/**
 * POS — Credit-note / gift-card code helpers (pure, unit-testable).
 * Extracted from ReturnsService (behavior-preserving): code formatting
 * (prefix + 10 uppercase hex chars) and the normalization applied before
 * storing or looking up a code (trim + uppercase).
 */

export const AVOIR_PREFIX = 'AV-';
export const GIFT_PREFIX = 'GC-';

/** Normalize a user- or system-supplied code for storage / lookup. Nullish → ''. */
export function normalizeCreditCode(code: string | null | undefined): string {
  return (code ?? '').trim().toUpperCase();
}

/**
 * Format a generated code from a hex source (e.g. randomBytes(5).toString('hex')):
 * `${prefix}` + first 10 uppercase hex chars. Mirrors the legacy genCode/genGiftCode.
 */
export function formatCreditCode(prefix: string, hex: string): string {
  return `${prefix}${hex.toUpperCase().slice(0, 10)}`;
}

/** True when `code` matches the shape of a CAISSE-generated avoir/gift code. */
export function isGeneratedCreditCode(code: string | null | undefined): boolean {
  return typeof code === 'string' && /^(AV|GC)-[0-9A-F]{10}$/.test(code);
}
