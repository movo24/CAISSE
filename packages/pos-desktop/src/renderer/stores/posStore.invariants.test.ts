/**
 * posStore BUSINESS INVARIANT — a cart total is never negative.
 *
 * Decision: if discounts exceed the subtotal, total() is clamped at 0. Discount
 * semantics and internal line state are unchanged; only the final total clamps.
 * (Resolves the ambiguity previously flagged on test/frontend-stores-coverage.)
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { usePOSStore, CartItem } from './posStore';

const line = (over: Partial<CartItem> = {}): CartItem => ({
  productId: 'p1',
  ean: '111',
  name: 'Café',
  unitPriceMinorUnits: 500,
  quantity: 1,
  discountMinorUnits: 0,
  ...over,
});

beforeEach(() => usePOSStore.setState({ cartItems: [] }));

describe('posStore invariant — cart total never negative', () => {
  it('clamps total() at 0 when discount exceeds subtotal (subtotal/discount unchanged)', () => {
    usePOSStore.setState({
      cartItems: [line({ unitPriceMinorUnits: 500, quantity: 1, discountMinorUnits: 800 })],
    });
    expect(usePOSStore.getState().subtotal()).toBe(500); // line state intact
    expect(usePOSStore.getState().totalDiscount()).toBe(800); // discount semantics intact
    expect(usePOSStore.getState().total()).toBe(0); // clamped — never negative
  });

  it('exactly-zero boundary: discount == subtotal → total 0', () => {
    usePOSStore.setState({
      cartItems: [line({ unitPriceMinorUnits: 500, quantity: 1, discountMinorUnits: 500 })],
    });
    expect(usePOSStore.getState().total()).toBe(0);
  });

  it('positive total is unaffected by the clamp', () => {
    usePOSStore.setState({
      cartItems: [line({ unitPriceMinorUnits: 1000, quantity: 1, discountMinorUnits: 300 })],
    });
    expect(usePOSStore.getState().total()).toBe(700);
  });
});
