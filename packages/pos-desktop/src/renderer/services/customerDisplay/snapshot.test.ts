import { describe, it, expect } from 'vitest';
import { buildSnapshot, emptySnapshot, formatPrice, MAX_SNAPSHOT_ITEMS } from './snapshot';

const branding = { storeName: "The Wesley's", terminalLabel: 'TERMINAL 01' };
const now = '2026-07-05T10:00:00.000Z';

describe('buildSnapshot', () => {
  it('projects items with line totals and counts quantities', () => {
    const snap = buildSnapshot(
      {
        items: [
          { name: 'Cola', quantity: 2, unitPriceMinorUnits: 150, discountMinorUnits: 0 },
          { name: 'Chips', quantity: 1, unitPriceMinorUnits: 200, discountMinorUnits: 20 },
        ],
        subtotalMinorUnits: 500,
        totalDiscountMinorUnits: 20,
        totalMinorUnits: 480,
        customer: null,
      },
      branding,
      now,
    );
    expect(snap.items).toHaveLength(2);
    expect(snap.items[0].lineTotalMinorUnits).toBe(300);
    expect(snap.itemCount).toBe(3);
    expect(snap.totalMinorUnits).toBe(480);
    expect(snap.storeName).toBe("The Wesley's");
    expect(snap.at).toBe(now);
  });

  it('carries customer projection safely', () => {
    const snap = buildSnapshot(
      {
        items: [],
        subtotalMinorUnits: 0,
        totalDiscountMinorUnits: 0,
        totalMinorUnits: 0,
        customer: { firstName: 'Sam', loyaltyPoints: 42, isFirstPurchase: true },
      },
      branding,
      now,
    );
    expect(snap.customer).toEqual({ firstName: 'Sam', loyaltyPoints: 42, isFirstPurchase: true });
  });

  it('never produces negative money and rounds', () => {
    const snap = buildSnapshot(
      {
        items: [{ name: 'X', quantity: -3, unitPriceMinorUnits: -50, discountMinorUnits: -10 }],
        subtotalMinorUnits: -100,
        totalDiscountMinorUnits: -5,
        totalMinorUnits: -80,
        customer: null,
      },
      branding,
      now,
    );
    expect(snap.subtotalMinorUnits).toBe(0);
    expect(snap.totalMinorUnits).toBe(0);
    expect(snap.items[0].quantity).toBe(0);
    expect(snap.items[0].unitPriceMinorUnits).toBe(0);
  });

  it('caps the number of items carried', () => {
    const items = Array.from({ length: MAX_SNAPSHOT_ITEMS + 10 }, (_, i) => ({
      name: `P${i}`,
      quantity: 1,
      unitPriceMinorUnits: 100,
      discountMinorUnits: 0,
    }));
    const snap = buildSnapshot(
      { items, subtotalMinorUnits: 0, totalDiscountMinorUnits: 0, totalMinorUnits: 0, customer: null },
      branding,
      now,
    );
    expect(snap.items).toHaveLength(MAX_SNAPSHOT_ITEMS);
    // itemCount still reflects every line's quantity, not just the carried ones.
    expect(snap.itemCount).toBe(MAX_SNAPSHOT_ITEMS + 10);
  });

  it('emptySnapshot has no items and zero totals', () => {
    const snap = emptySnapshot(branding, now);
    expect(snap.items).toHaveLength(0);
    expect(snap.itemCount).toBe(0);
    expect(snap.totalMinorUnits).toBe(0);
  });
});

describe('formatPrice', () => {
  it('formats centimes as French euros', () => {
    expect(formatPrice(1234)).toBe('12,34\u00a0\u20ac');
    expect(formatPrice(0)).toBe('0,00\u00a0\u20ac');
    expect(formatPrice(999)).toBe('9,99\u00a0\u20ac');
  });
});
