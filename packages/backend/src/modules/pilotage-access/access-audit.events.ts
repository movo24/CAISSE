/**
 * Types d'événements du journal d'audit des droits (`access_audit_log`).
 * Liste blanche — aucune autre valeur ne doit être écrite.
 */
export const ACCESS_AUDIT_EVENTS = [
  'ACCESS_GRANTED',
  'ACCESS_UPDATED',
  'ACCESS_REVOKED',
  'ROLE_CHANGED',
  'STORE_ADDED',
  'STORE_REMOVED',
  'ACCOUNT_SUSPENDED',
  'ACCOUNT_REACTIVATED',
  'SESSION_REVOKED',
  'ALL_SESSIONS_REVOKED',
  'PASSKEY_ADDED',
  'PASSKEY_REMOVED',
] as const;

export type AccessAuditEvent = (typeof ACCESS_AUDIT_EVENTS)[number];

export function isAccessAuditEvent(v: string): v is AccessAuditEvent {
  return (ACCESS_AUDIT_EVENTS as readonly string[]).includes(v);
}
