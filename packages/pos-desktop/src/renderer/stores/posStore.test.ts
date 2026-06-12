/**
 * posStore — cart math + mutations, asserting the store's REAL behaviour.
 *
 * Notes on scope/observed behaviour (not invented rules):
 *  - All amounts are integer minor units (centimes) → the selectors do exact
 *    integer arithmetic; there is NO rounding step in posStore (rounding is N/A).
 *  - posStore computes NO tax: `total() = subtotal() − totalDiscount()`. Tax is a
 *    backend concern (sales.service), so "taxes" is not applicable to this store.
 *  - `total()` is NOT clamped: a discount larger than the subtotal yields a
 *    NEGATIVE total. That edge is asserted as the current real behaviour, plus a
 *    named `.todo` flagging the unconfirmed business rule (see the block below).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { usePOSStore, CartItem } from './posStore';

// A full cart line (for direct state seeding when we need quantities/discounts —
// addToCart always forces quantity:1, discount:0, so it can't express those).
const line = (over: Partial<CartItem> = {}): CartItem => ({
  productId: 'p1',
  ean: '111',
  name: 'Café',
  unitPriceMinorUnits: 500,
  quantity: 1,
  discountMinorUnits: 0,
  ...over,
});

// addToCart input = Omit<CartItem, 'quantity' | 'discountMinorUnits'>.
const addable = (over: Partial<CartItem> = {}) => ({
  productId: over.productId ?? 'p1',
  ean: over.ean ?? '111',
  name: over.name ?? 'Café',
  unitPriceMinorUnits: over.unitPriceMinorUnits ?? 500,
});

beforeEach(() => {
  usePOSStore.setState({
    cartItems: [],
    customer: null,
    customerQrCode: null,
    paymentModalOpen: false,
  });
});

describe('posStore — addToCart', () => {
  it('adds a new product as a line with quantity 1 and zero discount', () => {
    usePOSStore.getState().addToCart(addable());
    const items = usePOSStore.getState().cartItems;
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ productId: 'p1', quantity: 1, discountMinorUnits: 0 });
  });

  it('increments quantity when the same productId is added again (not a 2nd line)', () => {
    const s = usePOSStore.getState();
    s.addToCart(addable());
    s.addToCart(addable());
    const items = usePOSStore.getState().cartItems;
    expect(items).toHaveLength(1);
    expect(items[0].quantity).toBe(2);
  });

  it('keeps distinct products as separate lines', () => {
    const s = usePOSStore.getState();
    s.addToCart(addable({ productId: 'a' }));
    s.addToCart(addable({ productId: 'b' }));
    expect(usePOSStore.getState().cartItems.map((i) => i.productId)).toEqual(['a', 'b']);
  });
});

describe('posStore — updateQuantity', () => {
  it('sets the quantity on the matching line', () => {
    usePOSStore.setState({ cartItems: [line({ quantity: 1 })] });
    usePOSStore.getState().updateQuantity('p1', 5);
    expect(usePOSStore.getState().cartItems[0].quantity).toBe(5);
  });

  it('removes the line when quantity is set to 0', () => {
    usePOSStore.setState({ cartItems: [line()] });
    usePOSStore.getState().updateQuantity('p1', 0);
    expect(usePOSStore.getState().cartItems).toHaveLength(0);
  });

  it('removes the line on a negative quantity', () => {
    usePOSStore.setState({ cartItems: [line()] });
    usePOSStore.getState().updateQuantity('p1', -3);
    expect(usePOSStore.getState().cartItems).toHaveLength(0);
  });
});

describe('posStore — removeFromCart', () => {
  it('removes only the matching line', () => {
    usePOSStore.setState({ cartItems: [line({ productId: 'a' }), line({ productId: 'b' })] });
    usePOSStore.getState().removeFromCart('a');
    expect(usePOSStore.getState().cartItems.map((i) => i.productId)).toEqual(['b']);
  });

  it('is a no-op for an unknown productId', () => {
    usePOSStore.setState({ cartItems: [line({ productId: 'a' })] });
    usePOSStore.getState().removeFromCart('zzz');
    expect(usePOSStore.getState().cartItems).toHaveLength(1);
  });
});

describe('posStore — clearCart', () => {
  it('empties the cart, clears the customer, and closes the payment modal', () => {
    usePOSStore.setState({
      cartItems: [line()],
      customer: {} as any,
      customerQrCode: 'QR',
      paymentModalOpen: true,
    });
    usePOSStore.getState().clearCart();
    const st = usePOSStore.getState();
    expect(st.cartItems).toHaveLength(0);
    expect(st.customer).toBeNull();
    expect(st.customerQrCode).toBeNull();
    expect(st.paymentModalOpen).toBe(false);
  });
});

describe('posStore — selectors (subtotal / totalDiscount / total)', () => {
  it('empty cart → subtotal, totalDiscount, total all 0', () => {
    const st = usePOSStore.getState();
    expect(st.subtotal()).toBe(0);
    expect(st.totalDiscount()).toBe(0);
    expect(st.total()).toBe(0);
  });

  it('subtotal = Σ unitPrice × quantity (exact integer centimes, no rounding)', () => {
    usePOSStore.setState({
      cartItems: [
        line({ productId: 'a', unitPriceMinorUnits: 500, quantity: 3 }),
        line({ productId: 'b', unitPriceMinorUnits: 199, quantity: 2 }),
      ],
    });
    expect(usePOSStore.getState().subtotal()).toBe(500 * 3 + 199 * 2); // 1898 — exact
  });

  it('totalDiscount = Σ per-line discountMinorUnits', () => {
    usePOSStore.setState({
      cartItems: [
        line({ productId: 'a', discountMinorUnits: 100 }),
        line({ productId: 'b', discountMinorUnits: 50 }),
      ],
    });
    expect(usePOSStore.getState().totalDiscount()).toBe(150);
  });

  it('total = subtotal − totalDiscount', () => {
    usePOSStore.setState({
      cartItems: [line({ unitPriceMinorUnits: 1000, quantity: 1, discountMinorUnits: 300 })],
    });
    expect(usePOSStore.getState().total()).toBe(700);
  });

  it('selectors reflect a quantity change', () => {
    usePOSStore.setState({ cartItems: [line({ unitPriceMinorUnits: 500, quantity: 1 })] });
    usePOSStore.getState().updateQuantity('p1', 4);
    expect(usePOSStore.getState().subtotal()).toBe(2000);
  });
});

// NOTE: the "discount > subtotal" edge (previously documented here as an ambiguity
// + it.todo) is RESOLVED by fix/frontend-store-business-rules (RULE 1 — total()
// clamps at 0). Its firm invariant lives in posStore.invariants.test.ts on that
// branch; the ambiguity block was removed here so this suite stays consistent once
// the invariants PR is on main (it merges first).
