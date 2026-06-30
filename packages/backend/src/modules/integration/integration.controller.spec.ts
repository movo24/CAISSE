import { IntegrationController } from './integration.controller';

/**
 * POS-INT-124 — routing smoke test (no DB, no Nest container).
 * Proves the new read endpoints delegate to the service with the tenant storeId
 * taken from the JWT (req.user.storeId) — never from a query param (anti-IDOR) —
 * and that the format switch is honored.
 */
describe('IntegrationController — routing (POS-INT-124)', () => {
  const req = { user: { storeId: 'store-JWT' } };
  let queryService: any;
  let reconciliation: any;
  let relay: any;
  let controller: IntegrationController;

  beforeEach(() => {
    queryService = {
      shiftsForDay: jest.fn().mockResolvedValue({ tag: 'shifts-json' }),
      shiftsForDayCsv: jest.fn().mockResolvedValue('shifts;csv'),
      stockSignalsForDay: jest.fn().mockResolvedValue({ tag: 'stock-json' }),
      stats: jest.fn().mockResolvedValue({ tag: 'stats' }),
      listForConsumer: jest.fn().mockResolvedValue({ events: [], nextCursor: null }),
    };
    reconciliation = { reconcileToday: jest.fn().mockResolvedValue({ tag: 'recon' }) };
    relay = { relayBatch: jest.fn().mockResolvedValue({ tag: 'relay' }) };
    controller = new IntegrationController(relay as any, queryService as any, reconciliation as any);
  });

  it('GET /events uses JWT storeId, passes query untouched', async () => {
    await controller.events(req, '2026-06-29T10:00:00.000Z|e1', 'sale.completed', '100');
    expect(queryService.listForConsumer).toHaveBeenCalledWith('store-JWT', {
      since: '2026-06-29T10:00:00.000Z|e1', type: 'sale.completed', limit: '100',
    });
  });

  it('GET /reconciliation uses JWT storeId + optional employeeId', async () => {
    await controller.reconciliationToday(req, 'emp-9');
    expect(reconciliation.reconcileToday).toHaveBeenCalledWith('store-JWT', 'emp-9');
  });

  it('GET /outbox/stats uses JWT storeId', async () => {
    await controller.outboxStats(req);
    expect(queryService.stats).toHaveBeenCalledWith('store-JWT');
  });

  it('POST /relay flushes the JWT store (clamped limit)', async () => {
    await controller.runRelay(req, '50');
    expect(relay.relayBatch).toHaveBeenCalledWith(50, 'store-JWT');
  });

  it('GET /shifts (json) uses JWT storeId, not the query', async () => {
    await controller.shifts(req, '2026-06-29');
    expect(queryService.shiftsForDay).toHaveBeenCalledWith('store-JWT', '2026-06-29');
    expect(queryService.shiftsForDayCsv).not.toHaveBeenCalled();
  });

  it('GET /shifts?format=csv routes to the CSV variant', async () => {
    const out = await controller.shifts(req, '2026-06-29', 'csv');
    expect(queryService.shiftsForDayCsv).toHaveBeenCalledWith('store-JWT', '2026-06-29');
    expect(out).toBe('shifts;csv');
  });

  it('GET /stock-signals uses JWT storeId', async () => {
    await controller.stockSignals(req, '2026-06-29');
    expect(queryService.stockSignalsForDay).toHaveBeenCalledWith('store-JWT', '2026-06-29');
  });
});
