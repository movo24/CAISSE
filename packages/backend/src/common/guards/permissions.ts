/**
 * CAISSE — Role & Permission Matrix
 *
 * ┌─────────────────────────────┬──────────┬──────────┬──────────┐
 * │ Permission                  │ admin    │ manager  │ cashier  │
 * │                             │(org_adm) │(store_mg)│(employee)│
 * ├─────────────────────────────┼──────────┼──────────┼──────────┤
 * │ View dashboard              │    ✅    │    ✅    │    ✅    │
 * │ View products               │    ✅    │    ✅    │    ✅    │
 * │ View stock alerts           │    ✅    │    ✅    │    ✅    │
 * │ Process sales (POS)         │    ✅    │    ✅    │    ✅    │
 * │ Clock in/out (pointage)     │    ✅    │    ✅    │    ✅    │
 * │ Scan inventory              │    ✅    │    ✅    │    ❌    │
 * │ Adjust stock                │    ✅    │    ✅    │    ❌    │
 * │ View employees              │    ✅    │    ✅    │    ❌    │
 * │ View reports                │    ✅    │    ✅    │    ❌    │
 * │ View planning               │    ✅    │    ✅    │    ❌    │
 * │ View performance            │    ✅    │    ✅    │    ❌    │
 * │ Void/refund sale            │    ✅    │    ✅    │    ❌    │
 * │ Create/edit employees       │    ✅    │    ❌    │    ❌    │
 * │ Deactivate employees        │    ✅    │    ❌    │    ❌    │
 * │ Create/edit stores          │    ✅    │    ❌    │    ❌    │
 * │ Archive/delete stores       │    ✅    │    ❌    │    ❌    │
 * │ Manage organizations        │    ✅    │    ❌    │    ❌    │
 * │ Manage units                │    ✅    │    ❌    │    ❌    │
 * │ Manage connected apps       │    ✅    │    ❌    │    ❌    │
 * │ Manage billing              │    ✅    │    ❌    │    ❌    │
 * │ Manage payroll              │    ✅    │    ❌    │    ❌    │
 * │ Manage rights/permissions   │    ✅    │    ❌    │    ❌    │
 * │ Access all stores           │    ✅    │    ❌    │    ❌    │
 * │ Switch stores               │    ✅    │    ❌    │    ❌    │
 * │ Access TimeWin24 (future)   │    ✅    │    ✅    │    ❌    │
 * └─────────────────────────────┴──────────┴──────────┴──────────┘
 *
 * SCOPE RULES:
 *   admin    → all stores in the system (multi-store)
 *   manager  → only assigned store(s)
 *   cashier  → only own store
 *
 * STORE OPERATIONS:
 *   Create store  → admin only
 *   Edit store    → admin only
 *   Archive store → admin only
 *   Delete store  → admin only
 *   Reactivate    → admin only
 *
 * SESSION MODEL:
 *   authSession   → JWT (employeeId, storeId, role)
 *   currentStore  → localStorage (can differ from JWT storeId for admins)
 *   currentApp    → localStorage ('pos' | 'timewin24')
 *
 * IMPORTANT:
 *   Store deletion does NOT destroy authSession.
 *   Only currentStoreId is cleared → user stays logged in.
 */

export const ROLE_HIERARCHY = {
  cashier: 0,
  manager: 1,
  admin: 2,
} as const;

export type Role = keyof typeof ROLE_HIERARCHY;

/** Business role aliases for documentation */
export const ROLE_ALIASES: Record<Role, string> = {
  admin: 'org_admin / super_admin',
  manager: 'store_manager',
  cashier: 'employee',
};

export function hasMinRole(userRole: string, minRole: Role): boolean {
  return (ROLE_HIERARCHY[userRole as Role] ?? -1) >= ROLE_HIERARCHY[minRole];
}
