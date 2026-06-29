import { buildRefundOutboxEvent, buildGiftCardOutboxEvent } from './refund-events';

describe('POS returns refund-events', () => {
  const ts = '2026-06-29T12:00:00.000Z';

  it('store_credit return → credit_note.issued (aggregate credit_note)', () => {
    const e = buildRefundOutboxEvent({
      creditNoteId: 'cn-1', code: 'AV-0123456789', storeId: 'store-1',
      employeeId: 'emp-1', type: 'store_credit', refundMethod: null,
      originalSaleId: 'sale-1', originalTicketNumber: 'T-1',
      totalMinorUnits: 1500, currencyCode: 'EUR', reason: 'défaut', occurredAt: ts,
    });
    expect(e.type).toBe('credit_note.issued');
    expect(e.aggregateType).toBe('credit_note');
    expect(e.payload).toMatchObject({
      code: 'AV-0123456789', origin: 'return', type: 'store_credit',
      refundMethod: null, originalSaleId: 'sale-1', totalMinorUnits: 1500,
    });
    expect(e.occurredAt).toBe(ts);
  });

  it('cash/card return → refund.created (aggregate refund)', () => {
    const e = buildRefundOutboxEvent({
      creditNoteId: 'cn-2', code: 'AV-AAAAAAAAAA', storeId: 'store-1',
      employeeId: 'emp-1', type: 'refund', refundMethod: 'cash',
      originalSaleId: 'sale-2', originalTicketNumber: 'T-2',
      totalMinorUnits: 800, currencyCode: 'EUR', reason: null, occurredAt: ts,
    });
    expect(e.type).toBe('refund.created');
    expect(e.aggregateType).toBe('refund');
    expect(e.payload).toMatchObject({ refundMethod: 'cash', totalMinorUnits: 800 });
  });

  it('gift card → credit_note.issued (origin gift_card)', () => {
    const e = buildGiftCardOutboxEvent({
      creditNoteId: 'gc-1', code: 'GC-0123456789', storeId: 'store-1',
      employeeId: 'emp-1', amountMinorUnits: 5000, currencyCode: 'EUR', occurredAt: ts,
    });
    expect(e.type).toBe('credit_note.issued');
    expect(e.payload).toMatchObject({ origin: 'gift_card', type: 'store_credit', amountMinorUnits: 5000 });
    expect(e.tenant.storeId).toBe('store-1');
  });
});
