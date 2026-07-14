/**
 * POS-094 — Customer access control (anti-IDOR), pure & unit-testable.
 * A caller may read a customer only if admin (cross-store) or the customer belongs to the
 * caller's store. Fail-closed: unknown/missing store (and non-admin) → denied.
 */
export function canAccessCustomer(
  customerStoreId: string | null | undefined,
  callerStoreId: string | null | undefined,
  role: string | null | undefined,
): boolean {
  if (role === 'admin') return true;
  if (!callerStoreId || !customerStoreId) return false;
  return customerStoreId === callerStoreId;
}
