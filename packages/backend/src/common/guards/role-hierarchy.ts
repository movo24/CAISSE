/**
 * POS-090 — Role hierarchy (pure, unit-testable). Extracted from RolesGuard
 * (behavior-preserving): admin > manager > cashier; a higher role inherits the
 * permissions of the lower ones.
 *
 *   admin   = super_admin / org_admin (full access, multi-store)
 *   manager = store_manager (assigned stores, operational access)
 *   cashier = employee (POS only, read-only backoffice)
 *
 * ── Permission matrix (canonical; moved here from the former guards/permissions.ts
 *    which duplicated this logic and was unused — POS-192) ─────────────────────
 *   dashboard / products / stock alerts / process sales / clock in-out : admin ✅ manager ✅ cashier ✅
 *   scan inventory / adjust stock / view employees|reports|planning|performance /
 *     void|refund sale : admin ✅ manager ✅ cashier ❌
 *   create|edit|deactivate employees / create|edit|archive|delete stores /
 *     manage organizations|units|connected-apps|billing|payroll|rights /
 *     access-all-stores / switch-stores : admin ✅ manager ❌ cashier ❌
 *   Scope: admin → all stores ; manager → assigned store(s) ; cashier → own store.
 */

export const ROLE_HIERARCHY: Record<string, number> = {
  cashier: 0,
  manager: 1,
  admin: 2,
};

/** Numeric level of a role; unknown/missing → -1 (denied). */
export function roleLevel(role: string | undefined | null): number {
  if (!role) return -1;
  return ROLE_HIERARCHY[role] ?? -1;
}

/**
 * True when the user's role level is >= at least one required role's level.
 * An unknown REQUIRED role is treated as unreachable (Infinity) → never satisfied,
 * matching the original guard semantics exactly.
 */
export function roleSatisfies(
  userRole: string | undefined | null,
  requiredRoles: string[],
): boolean {
  const level = roleLevel(userRole);
  return requiredRoles.some((r) => level >= (ROLE_HIERARCHY[r] ?? Infinity));
}
