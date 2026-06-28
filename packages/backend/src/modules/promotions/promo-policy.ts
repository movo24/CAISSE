/**
 * POS-070/073 — Promotion policy helpers (pure, no DB/Nest → unit-testable).
 *
 * Covers two of the three "refus" rules the product spec asks for on promo RULES:
 *  - expired / not-yet-started promos are inactive (refus promo expirée);
 *  - anti-stacking: at most one promo (the largest discount) per product
 *    (refus du doublon d'application).
 *
 * NOTE on the third rule (refus si plafond d'usage dépassé): the `promo_rule` entity
 * has NO usage-limit / usage-count column today, so a per-promo usage cap cannot be
 * enforced without a schema change — see TECHNICAL_DEBT TD-073-USAGE-LIMIT.
 * (Coupons — a separate module — already enforce idempotency via `lockedByIdempotencyKey`.)
 *
 * These helpers are NOT yet wired into `applyPromos` (that would change the live money
 * path, untestable in this sandbox) — see TD-073-STACKING.
 */

export interface PromoWindow {
  startDate: Date | string;
  endDate: Date | string | null;
  isActive: boolean;
}

/** True when a promo is active at `now`: flagged active AND within [start, end]. */
export function isPromoActive(p: PromoWindow, now: Date = new Date()): boolean {
  if (!p.isActive) return false;
  const start = new Date(p.startDate).getTime();
  if (Number.isNaN(start) || start > now.getTime()) return false;
  if (p.endDate != null) {
    const end = new Date(p.endDate).getTime();
    if (!Number.isNaN(end) && end < now.getTime()) return false;
  }
  return true;
}

/**
 * POS-073 — usage cap reached? null/undefined limit = unlimited (never reached).
 * A promo at/over its limit must be excluded from the active set.
 */
export function isUsageLimitReached(
  usageCount: number,
  usageLimit: number | null | undefined,
): boolean {
  if (usageLimit == null) return false;
  return usageCount >= usageLimit;
}

export interface PromoApplication {
  promoId: string;
  productId: string;
  discountMinorUnits: number;
}

/**
 * Anti-stacking — keep only the single largest discount per product.
 * Prevents two promos from compounding on the same product (refus du doublon).
 * Ties: the first occurrence wins (stable).
 */
export function dedupeBestPerProduct<T extends PromoApplication>(apps: T[]): T[] {
  const best = new Map<string, T>();
  for (const a of apps) {
    const cur = best.get(a.productId);
    if (!cur || a.discountMinorUnits > cur.discountMinorUnits) {
      best.set(a.productId, a);
    }
  }
  return [...best.values()];
}
