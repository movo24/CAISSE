/**
 * Rôles applicatifs de pilotage — dimension SÉPARÉE du rôle POS (cashier/manager/admin),
 * qui reste inchangé. Portés par `employee_application_access.application_role`.
 */
export const APPLICATION_ROLES = [
  'STORE_MANAGER',
  'ASSISTANT_MANAGER',
  'MULTI_STORE_MANAGER',
  'REGIONAL_MANAGER',
  'CENTRAL_DIRECTOR',
  'CENTRAL_ADMIN',
  'TECHNICAL_ADMIN',
  'CUSTOM_READ_ONLY',
] as const;

export type ApplicationRole = (typeof APPLICATION_ROLES)[number];

/** Rôles à périmètre GLOBAL (tous magasins) — bypass du périmètre, comme l'admin POS. */
export const GLOBAL_SCOPE_ROLES: readonly ApplicationRole[] = [
  'CENTRAL_DIRECTOR',
  'CENTRAL_ADMIN',
  'TECHNICAL_ADMIN',
];

/** Permissions granulaires par (employé, magasin) — noms = colonnes de employee_store_access. */
export const STORE_PERMISSIONS = [
  'can_view_dashboard',
  'can_view_financials',
  'can_view_employees',
  'can_view_alerts',
  'can_compare',
] as const;

export type StorePermission = (typeof STORE_PERMISSIONS)[number];

/** Raisons de refus internes → mappées vers un code HTTP par le guard (Lot 3). */
export type AccessDenyReason =
  | 'ACCOUNT_INACTIVE'
  | 'NO_APPLICATION_ACCESS'
  | 'ACCOUNT_SUSPENDED'
  | 'ACCESS_EXPIRED'
  | 'STORE_NOT_IN_SCOPE'
  | 'PERMISSION_DENIED';

export function isApplicationRole(v: string): v is ApplicationRole {
  return (APPLICATION_ROLES as readonly string[]).includes(v);
}

export function isGlobalScopeRole(role: string | null | undefined): boolean {
  return !!role && (GLOBAL_SCOPE_ROLES as readonly string[]).includes(role);
}
