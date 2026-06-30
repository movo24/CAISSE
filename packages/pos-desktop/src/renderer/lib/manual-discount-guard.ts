/**
 * POS-FE-159 — manual responsable-discount offline arbitration (TD-FE-OFFLINE-DISCOUNT).
 *
 * A manual cashier discount above the auto threshold requires a RESPONSABLE PIN
 * verified server-side (backend returns 400 on invalid PIN). When the terminal is
 * offline the PIN cannot be verified, and the resulting sale is validated +
 * immutable (NF525) before any resync check — so an unverifiable authorization
 * would be baked into the audit chain. Consistent with QR/wallet payments that
 * already require Internet, the safe arbitration is: BLOCK manual discount while
 * offline. Pure & unit-testable.
 */
export interface ManualDiscountGuardInput {
  isOffline: boolean;
}

export interface GuardResult {
  allowed: boolean;
  reason?: string;
}

export function manualDiscountGuard({ isOffline }: ManualDiscountGuardInput): GuardResult {
  if (isOffline) {
    return {
      allowed: false,
      reason:
        'Remise responsable indisponible hors-ligne : le code responsable ne peut pas être vérifié. Réessayez une fois la connexion rétablie.',
    };
  }
  return { allowed: true };
}
