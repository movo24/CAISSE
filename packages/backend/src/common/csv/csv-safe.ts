/**
 * POS-INT-113 — CSV cell hardening (pure, unit-testable).
 *
 * Two distinct risks when a CSV is opened in Excel / LibreOffice / Sheets:
 *  1. Delimiter/quote breakage — a field containing the delimiter, a quote or a
 *     newline must be quoted (RFC 4180).
 *  2. Formula injection (CSV injection) — a TEXT field whose first character is
 *     `=`, `+`, `-`, `@`, or a leading TAB/CR/LF is interpreted as a formula and
 *     executed on open. Mitigation: prefix the cell with a single quote so the
 *     spreadsheet treats it as literal text.
 *
 * Numeric and boolean values are emitted verbatim (only quoted if needed): a real
 * number like `-100` is a value, not a payload, and must NOT be mangled — the
 * formula guard applies to STRINGS only. This keeps accounting amounts intact
 * while neutralizing operator/device-controlled free text (labels, ids, names).
 */

const FORMULA_LEAD = /^[=+\-@\t\r\n]/;
const NEEDS_QUOTING = /[",\n\r;\t]/;

function quoteIfNeeded(s: string): string {
  return NEEDS_QUOTING.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Hardened CSV cell: formula-injection guard for text + RFC4180 quoting. */
export function csvSafeCell(value: string | number | boolean | null | undefined): string {
  if (value === null || value === undefined) return '';
  // numbers/booleans carry no formula payload — never apply the leading-char guard
  if (typeof value === 'number' || typeof value === 'boolean') {
    return quoteIfNeeded(String(value));
  }
  let s = String(value);
  if (FORMULA_LEAD.test(s)) s = `'${s}`; // neutralize: literal text
  return quoteIfNeeded(s);
}

/** Join an array of cells into one hardened CSV row (default delimiter `,`). */
export function csvSafeRow(
  cells: readonly (string | number | boolean | null | undefined)[],
  delimiter = ',',
): string {
  return cells.map(csvSafeCell).join(delimiter);
}
