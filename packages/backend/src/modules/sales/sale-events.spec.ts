import { buildSaleOutboxEvents, SaleEventInput } from './sale-events';

const base: SaleEventInput = {
  saleId: 'sale-1',
  ticketNumber: 'T-001',
  storeId: 'store-1',
  organizationId: 'org-1',
  terminalId: 'TERM-1',
  employeeId: 'emp-1',
  employeeRole: 'cashier',
  completedAt: '2026-06-29T10:00:00.000Z',
  currencyCode: 'EUR',
  subtotalMinorUnits: 3000,
  discountTotalMinorUnits: 300,
  taxTotalMinorUnits: 450,
  totalMinorUnits: 2700,
  customerId: 'cust-1',
  items: [
    { ean: '111', quantity: 2, lineTotalMinorUnits: 2000 },
    { ean: '222', quantity: 1, lineTotalMinorUnits: 1000 },
  ],
  payments: [
    { method: 'card', amountMinorUnits: 2000 },
    { method: 'cash', amountMinorUnits: 700 },
  ],
};

describe('POS sale-events outbox mapper', () => {
  it('emits 1 sale.completed + 1 payment.captured per tender', () => {
    const evs = buildSaleOutboxEvents(base);
    expect(evs).toHaveLength(3);
    expect(evs[0].type).toBe('sale.completed');
    expect(evs.slice(1).map((e) => e.type)).toEqual(['payment.captured', 'payment.captured']);
  });

  it('sale.completed carries fiscal totals + line summary + payment methods', () => {
    const [sale] = buildSaleOutboxEvents(base);
    expect(sale.aggregateType).toBe('sale');
    expect(sale.aggregateId).toBe('sale-1');
    expect(sale.payload).toMatchObject({
      ticketNumber: 'T-001',
      currencyCode: 'EUR',
      subtotalMinorUnits: 3000,
      discountTotalMinorUnits: 300,
      taxTotalMinorUnits: 450,
      totalMinorUnits: 2700,
      customerId: 'cust-1',
      itemCount: 2,
      paymentMethods: ['card', 'cash'],
    });
    expect(sale.payload.items).toEqual([
      { ean: '111', quantity: 2, lineTotalMinorUnits: 2000, taxRate: null },
      { ean: '222', quantity: 1, lineTotalMinorUnits: 1000, taxRate: null },
    ]);
  });

  it('sale.completed carries per-rate VAT breakdown when items have taxRate', () => {
    const [sale] = buildSaleOutboxEvents({
      ...base,
      items: [
        { ean: '111', quantity: 2, lineTotalMinorUnits: 1200, taxRate: 20 }, // tax 200
        { ean: '222', quantity: 1, lineTotalMinorUnits: 1100, taxRate: 10 }, // tax 100
      ],
    });
    expect(sale.payload.taxBreakdown).toEqual([
      { rate: 10, grossMinorUnits: 1100, taxMinorUnits: 100, baseMinorUnits: 1000 },
      { rate: 20, grossMinorUnits: 1200, taxMinorUnits: 200, baseMinorUnits: 1000 },
    ]);
  });

  it('payment events carry method + amount, bound to the sale aggregate', () => {
    const [, card, cash] = buildSaleOutboxEvents(base);
    expect(card.aggregateType).toBe('payment');
    expect(card.aggregateId).toBe('sale-1');
    expect(card.payload).toMatchObject({ method: 'card', amountMinorUnits: 2000, currencyCode: 'EUR' });
    expect(cash.payload).toMatchObject({ method: 'cash', amountMinorUnits: 700 });
  });

  it('all events share tenant, actor and occurredAt (deterministic ordering)', () => {
    const evs = buildSaleOutboxEvents(base);
    for (const e of evs) {
      expect(e.tenant).toEqual({ organizationId: 'org-1', storeId: 'store-1', terminalId: 'TERM-1' });
      expect(e.actor).toEqual({ employeeId: 'emp-1', role: 'cashier' });
      expect(e.occurredAt).toBe('2026-06-29T10:00:00.000Z');
      expect(e.source).toBe('pos-caisse');
      expect(e.schemaVersion).toBe(1);
      expect(e.id).toMatch(/^[0-9a-f-]{36}$/i);
    }
  });

  it('defaults org/terminal/role to null when not provided', () => {
    const evs = buildSaleOutboxEvents({
      ...base,
      organizationId: undefined,
      terminalId: undefined,
      employeeRole: undefined,
    });
    expect(evs[0].tenant).toEqual({ organizationId: null, storeId: 'store-1', terminalId: null });
    expect(evs[0].actor).toEqual({ employeeId: 'emp-1', role: null });
  });
});
