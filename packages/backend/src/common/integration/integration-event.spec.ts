import {
  buildIntegrationEvent,
  INTEGRATION_SOURCE,
  INTEGRATION_SCHEMA_VERSION,
} from './integration-event';

describe('POS integration-event envelope', () => {
  const base = {
    type: 'sale.completed' as const,
    aggregateType: 'sale' as const,
    aggregateId: 'sale-1',
    tenant: { organizationId: 'org-1', storeId: 'store-1', terminalId: 'T1' },
    payload: { totalMinorUnits: 2990 },
  };

  it('builds a normalized envelope with deterministic id/timestamp when supplied', () => {
    const e = buildIntegrationEvent({
      ...base,
      id: 'evt-1',
      occurredAt: new Date('2026-06-29T10:00:00Z'),
      actor: { employeeId: 'emp-1', role: 'cashier' },
    });
    expect(e).toEqual({
      id: 'evt-1',
      type: 'sale.completed',
      aggregateType: 'sale',
      aggregateId: 'sale-1',
      occurredAt: '2026-06-29T10:00:00.000Z',
      tenant: { organizationId: 'org-1', storeId: 'store-1', terminalId: 'T1' },
      actor: { employeeId: 'emp-1', role: 'cashier' },
      payload: { totalMinorUnits: 2990 },
      schemaVersion: INTEGRATION_SCHEMA_VERSION,
      source: INTEGRATION_SOURCE,
    });
  });

  it('defaults tenant.organizationId/terminalId and actor to null', () => {
    const e = buildIntegrationEvent({
      ...base,
      id: 'evt-2',
      occurredAt: '2026-06-29T10:00:00.000Z',
      tenant: { organizationId: null, storeId: 'store-1' },
    });
    expect(e.tenant).toEqual({ organizationId: null, storeId: 'store-1', terminalId: null });
    expect(e.actor).toEqual({ employeeId: null, role: null });
  });

  it('auto-generates a UUID id and ISO occurredAt when omitted', () => {
    const e = buildIntegrationEvent(base);
    expect(e.id).toMatch(/^[0-9a-f-]{36}$/i);
    expect(() => new Date(e.occurredAt).toISOString()).not.toThrow();
    expect(e.occurredAt).toBe(new Date(e.occurredAt).toISOString());
  });

  it('accepts a string occurredAt as-is', () => {
    const e = buildIntegrationEvent({ ...base, occurredAt: '2026-01-01T00:00:00.000Z' });
    expect(e.occurredAt).toBe('2026-01-01T00:00:00.000Z');
  });

  it('always stamps source + schemaVersion', () => {
    const e = buildIntegrationEvent(base);
    expect(e.source).toBe('pos-caisse');
    expect(e.schemaVersion).toBe(1);
  });

  it('rejects missing tenant.storeId or aggregateId (integrity guard)', () => {
    expect(() =>
      buildIntegrationEvent({ ...base, tenant: { organizationId: null, storeId: '' } }),
    ).toThrow(/storeId/);
    expect(() => buildIntegrationEvent({ ...base, aggregateId: '' })).toThrow(/aggregateId/);
  });
});
