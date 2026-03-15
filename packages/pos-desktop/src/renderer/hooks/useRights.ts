import { useCallback, useMemo } from 'react';
import { useRightsStore, EmployeeRights } from '../stores/rightsStore';

/**
 * Hook to check employee rights in POS components.
 * Returns boolean helpers + maxDiscountPercent.
 *
 * SECURITY: dangerous operations default to FALSE when rights aren't loaded.
 * Only safe read-only operations (reports, reprint) default to true.
 * This prevents privilege escalation when the rights store hasn't loaded yet.
 */
export function useRights() {
  const rights = useRightsStore((s) => s.rights);

  const r = rights as EmployeeRights | null;

  // Dangerous operations → default FALSE (least privilege)
  const canVoid = r?.canVoidSale ?? false;
  const canRefund = r?.canRefund ?? false;
  const canDeleteTicket = r?.canDeleteTicket ?? false;
  const canApplyManualDiscount = r?.canApplyManualDiscount ?? false;
  const canOpenDrawer = r?.canOpenDrawer ?? false;
  const canManageStock = r?.canManageStock ?? false;

  // Safe / read-only operations → default TRUE (don't block basic usage)
  const canAccessReports = r?.canAccessReports ?? true;
  const canReprintTicket = r?.canReprintTicket ?? true;

  // Discount limit → default 0% when rights not loaded (no discount allowed)
  const maxDiscountPercent = r?.maxDiscountPercent ?? 0;

  /** Check if a specific discount % is allowed */
  const canDiscount = useCallback(
    (percent: number) => percent <= (r?.maxDiscountPercent ?? 0),
    [r?.maxDiscountPercent],
  );

  const role = r?.role ?? 'cashier';
  const isLoaded = r !== null;

  return useMemo(
    () => ({
      canVoid,
      canRefund,
      canAccessReports,
      canManageStock,
      canDeleteTicket,
      canApplyManualDiscount,
      canOpenDrawer,
      canReprintTicket,
      maxDiscountPercent,
      canDiscount,
      role,
      isLoaded,
    }),
    [canVoid, canRefund, canAccessReports, canManageStock, canDeleteTicket,
     canApplyManualDiscount, canOpenDrawer, canReprintTicket, maxDiscountPercent,
     canDiscount, role, isLoaded],
  );
}
