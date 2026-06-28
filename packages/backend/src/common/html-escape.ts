/**
 * POS-132 — HTML escaping for XSS prevention (pure, unit-testable).
 * All user-controlled data interpolated into HTML (e.g. receipts) MUST pass through this.
 * Escapes & < > " ' (the standard set sufficient for HTML text/attribute contexts).
 */
export function escapeHtml(str: string | null | undefined): string {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}
