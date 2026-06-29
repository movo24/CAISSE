/**
 * POS — Promotion discount math (pure, unit-testable). Integer centimes.
 * Extracted from PromotionsService.applyPromotions (behavior-preserving):
 * the per-type discount computation. Complements promo-policy.ts (active/dedup/limit).
 */

export const FIRST_PURCHASE_RATE = 0.05; // 5%

/**
 * buy_x_get_discount: every (buyQuantity+1)-group grants one discounted item.
 * Returns total discount in centimes (0 when no full group).
 */
export function buyXGetDiscount(
  quantity: number,
  buyQuantity: number,
  unitPriceMinorUnits: number,
  discountPercent: number,
): number {
  const groupSize = buyQuantity + 1;
  const discountedItems = Math.floor(quantity / groupSize);
  if (discountedItems <= 0) return 0;
  const discountPerItem = Math.round(unitPriceMinorUnits * (discountPercent / 100));
  return discountPerItem * discountedItems;
}

/** percentage discount on a line total. */
export function percentageDiscount(lineTotalMinorUnits: number, discountPercent: number): number {
  return Math.round(lineTotalMinorUnits * (discountPercent / 100));
}

/** first_purchase fixed-rate (5%) discount on a line total. */
export function firstPurchaseDiscount(lineTotalMinorUnits: number): number {
  return Math.round(lineTotalMinorUnits * FIRST_PURCHASE_RATE);
}

/** Line total in centimes. */
export function lineTotal(unitPriceMinorUnits: number, quantity: number): number {
  return unitPriceMinorUnits * quantity;
}
