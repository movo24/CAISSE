/**
 * Cockpit — role gate (UX ONLY). Ratified line: the client gate exists so we
 * don't show what can't be used; the GUARANTEE lives in the server's INV-5 scope
 * (every cockpit endpoint filters WHERE store_id IN resolved-scope). This
 * function never carries security — removing it would change what renders, not
 * what anyone can read.
 */
export const COCKPIT_ROLES = ['manager', 'admin', 'owner'];

export function canAccessCockpit(role: string | null | undefined): boolean {
  return COCKPIT_ROLES.includes((role ?? '').toLowerCase());
}
