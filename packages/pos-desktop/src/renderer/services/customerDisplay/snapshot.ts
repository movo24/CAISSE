/**
 * Customer Display — snapshot DTO + pure builder.
 *
 * The operator window broadcasts a `DisplaySnapshot` (a plain, serialisable
 * projection of the cart) to the display window. It is a *projection*: only
 * customer-safe fields, no internal ids beyond what the customer needs, no
 * mutation hooks. The display renders it read-only.
 */

export interface DisplaySnapshotItem {
  name: string;
  quantity: number;
  unitPriceMinorUnits: number;
  lineTotalMinorUnits: number;
  discountMinorUnits: number;
}

export interface DisplaySnapshotCustomer {
  firstName: string;
  loyaltyPoints: number;
  isFirstPurchase: boolean;
}

export interface DisplaySnapshot {
  storeName: string;
  terminalLabel: string;
  items: DisplaySnapshotItem[];
  itemCount: number;
  subtotalMinorUnits: number;
  totalDiscountMinorUnits: number;
  totalMinorUnits: number;
  customer: DisplaySnapshotCustomer | null;
  /** ISO time the snapshot was produced — used for staleness detection. */
  at: string;
}

/** Minimal shape the builder needs from the POS store (keeps this pure). */
export interface SnapshotSourceItem {
  name: string;
  quantity: number;
  unitPriceMinorUnits: number;
  discountMinorUnits: number;
}

export interface SnapshotSource {
  items: SnapshotSourceItem[];
  subtotalMinorUnits: number;
  totalDiscountMinorUnits: number;
  totalMinorUnits: number;
  customer: { firstName: string; loyaltyPoints: number; isFirstPurchase: boolean } | null;
}

export interface SnapshotBranding {
  storeName: string;
  terminalLabel: string;
}

/** Max item lines carried in a snapshot; extra lines are summarised on-screen. */
export const MAX_SNAPSHOT_ITEMS = 40;

export function buildSnapshot(
  source: SnapshotSource,
  branding: SnapshotBranding,
  now: string,
): DisplaySnapshot {
  const rawItems = Array.isArray(source.items) ? source.items : [];
  const items: DisplaySnapshotItem[] = rawItems.slice(0, MAX_SNAPSHOT_ITEMS).map((i) => ({
    name: i.name,
    quantity: Math.max(0, Math.round(i.quantity || 0)),
    unitPriceMinorUnits: Math.max(0, Math.round(i.unitPriceMinorUnits || 0)),
    lineTotalMinorUnits: Math.max(0, Math.round((i.unitPriceMinorUnits || 0) * (i.quantity || 0))),
    discountMinorUnits: Math.max(0, Math.round(i.discountMinorUnits || 0)),
  }));

  const itemCount = rawItems.reduce((s, i) => s + Math.max(0, Math.round(i.quantity || 0)), 0);

  return {
    storeName: branding.storeName,
    terminalLabel: branding.terminalLabel,
    items,
    itemCount,
    subtotalMinorUnits: Math.max(0, Math.round(source.subtotalMinorUnits || 0)),
    totalDiscountMinorUnits: Math.max(0, Math.round(source.totalDiscountMinorUnits || 0)),
    totalMinorUnits: Math.max(0, Math.round(source.totalMinorUnits || 0)),
    customer: source.customer
      ? {
          firstName: source.customer.firstName,
          loyaltyPoints: Math.max(0, Math.round(source.customer.loyaltyPoints || 0)),
          isFirstPurchase: !!source.customer.isFirstPurchase,
        }
      : null,
    at: now,
  };
}

/** Empty snapshot (no active sale) — used to reset the display to idle. */
export function emptySnapshot(branding: SnapshotBranding, now: string): DisplaySnapshot {
  return buildSnapshot(
    { items: [], subtotalMinorUnits: 0, totalDiscountMinorUnits: 0, totalMinorUnits: 0, customer: null },
    branding,
    now,
  );
}

/** Format centimes as a French price string: 1234 → "12,34 €". */
export function formatPrice(minorUnits: number): string {
  return (Math.round(minorUnits) / 100).toFixed(2).replace('.', ',') + '\u00a0\u20ac';
}
