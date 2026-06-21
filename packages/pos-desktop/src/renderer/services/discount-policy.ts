/**
 * Manual-discount policy (decision 5) — CLIENT MIRROR of the server enforcement.
 *
 * The server is the non-bypassable guarantee (sales.service: 30% hard cap +
 * manager approver). This mirror lets the POS refuse an impossible discount
 * BEFORE hitting the network — same rules, clear French message:
 *  - no free seller discount: any manual discount REQUIRES a manager approver;
 *  - hard cap 30% of the subtotal — never more.
 */
export const MANUAL_DISCOUNT_MAX_PCT = 30;

export interface ManualDiscountCheck {
  subtotalMinor: number;
  manualDiscountMinor: number;
  approverId?: string | null;
}

/**
 * Promo-code discount (decision 6), computed on the SAME base the server uses
 * (subtotal − line discounts − manual discount) so the client total matches the
 * server total exactly. Owner-defined → not subject to the 30% manual cap.
 */
export function computePromoDiscount(
  baseMinor: number,
  info: { discountType: 'percentage' | 'fixed'; discountValue: number } | null,
): number {
  if (!info || baseMinor <= 0) return 0;
  const raw = info.discountType === 'percentage'
    ? Math.floor(baseMinor * (info.discountValue / 100))
    : Math.min(info.discountValue, baseMinor);
  return Math.max(0, Math.min(raw, baseMinor));
}

export function validateManualDiscount(c: ManualDiscountCheck): { ok: boolean; reason?: string } {
  const discount = Math.max(0, Math.round(c.manualDiscountMinor || 0));
  if (discount === 0) return { ok: true }; // no manual discount → nothing to enforce
  if (c.subtotalMinor <= 0) return { ok: false, reason: 'Remise impossible sur un panier vide.' };
  const cap = Math.floor(c.subtotalMinor * (MANUAL_DISCOUNT_MAX_PCT / 100));
  if (discount > cap) {
    return {
      ok: false,
      reason: `Remise (${(discount / 100).toFixed(2)} €) supérieure au plafond de ${MANUAL_DISCOUNT_MAX_PCT}% (max ${(cap / 100).toFixed(2)} €).`,
    };
  }
  if (!c.approverId) {
    return { ok: false, reason: "Remise manuelle : validation d'un responsable requise." };
  }
  return { ok: true };
}
