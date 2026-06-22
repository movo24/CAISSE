import { describe, it, expect } from 'vitest';
import { toWirePayments, toSaleDiscountFields, toSyncCreateBody } from './salePayload';

/**
 * M603 — the offline enqueue used to map payments to {method, amountMinorUnits} only,
 * dropping creditNoteCode (→ an offline store_credit sale could not sync: the server
 * requires it) and the Stripe/terminal refs. Online + offline now share these builders.
 */
describe('toWirePayments (M603 — online/offline parity)', () => {
  it('preserves creditNoteCode for a store_credit leg', () => {
    const out = toWirePayments([
      { method: 'store_credit' as any, amountMinorUnits: 500, creditNoteCode: 'AV-XYZ' },
    ]);
    expect(out[0]).toMatchObject({ method: 'store_credit', amountMinorUnits: 500, creditNoteCode: 'AV-XYZ' });
  });

  it('preserves Stripe/terminal refs for a card leg', () => {
    const out = toWirePayments([
      { method: 'card' as any, amountMinorUnits: 1200, stripePaymentIntentId: 'pi_1', stripeReaderId: 'rd_1', terminalId: 'tm_1' },
    ]);
    expect(out[0]).toMatchObject({ stripePaymentIntentId: 'pi_1', stripeReaderId: 'rd_1', terminalId: 'tm_1' });
  });

  it('maps a mixed cart leg-by-leg (amounts + methods intact)', () => {
    const out = toWirePayments([
      { method: 'cash' as any, amountMinorUnits: 300 },
      { method: 'store_credit' as any, amountMinorUnits: 200, creditNoteCode: 'AV-2' },
    ]);
    expect(out).toHaveLength(2);
    expect(out.map((p) => p.amountMinorUnits)).toEqual([300, 200]);
    expect(out[1].creditNoteCode).toBe('AV-2');
  });
});

describe('toSaleDiscountFields (decisions 5/6 carried through offline)', () => {
  it('includes manual discount + approver only when a discount is set', () => {
    expect(toSaleDiscountFields({ manualDiscountMinorUnits: 0, discountApproverId: null, promoCode: null })).toEqual({});
    expect(toSaleDiscountFields({ manualDiscountMinorUnits: 200, discountApproverId: 'mgr', promoCode: null }))
      .toEqual({ manualDiscountMinorUnits: 200, discountApproverId: 'mgr' });
  });

  it('includes the promo code when present', () => {
    expect(toSaleDiscountFields({ manualDiscountMinorUnits: 0, discountApproverId: null, promoCode: 'BIENVENUE' }))
      .toEqual({ promoCode: 'BIENVENUE' });
  });
});

describe('toSyncCreateBody (M603 — offline queue → clean CreateSaleDto)', () => {
  const offlinePayload = {
    ticketNumber: 'OFF-ABC',        // display-only — must be stripped (would 400)
    totalMinorUnits: 700,           // display-only — must be stripped
    customerQrCode: 'CLI-1',
    promoCode: 'BIENVENUE',
    items: [{ ean: '111', quantity: 2, name: 'Bonbon', unitPriceMinorUnits: 350 }], // name/unitPrice stripped
    payments: [{ method: 'store_credit', amountMinorUnits: 700, creditNoteCode: 'AV-1' }],
  };

  it('strips display-only extras and reshapes items to {ean,quantity}', () => {
    const body = toSyncCreateBody(offlinePayload) as any;
    expect(body).not.toHaveProperty('ticketNumber');
    expect(body).not.toHaveProperty('totalMinorUnits');
    expect(body.items).toEqual([{ ean: '111', quantity: 2 }]); // no name/unitPrice
  });

  it('keeps payments (with creditNoteCode), customerQrCode and promo/discount', () => {
    const body = toSyncCreateBody(offlinePayload) as any;
    expect(body.payments[0]).toMatchObject({ method: 'store_credit', creditNoteCode: 'AV-1' });
    expect(body.customerQrCode).toBe('CLI-1');
    expect(body.promoCode).toBe('BIENVENUE');
  });
});
