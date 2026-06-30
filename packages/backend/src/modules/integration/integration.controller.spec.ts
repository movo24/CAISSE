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
  let controller: IntegrationController;

  beforeEach(() => {
    queryService = {
      shiftsForDay: jest.fn().mockResolvedValue({ tag: 'shifts-json' }),
      shiftsForDayCsv: jest.fn().mockResolvedValue('shifts;csv'),
      stockSignalsForDay: jest.fn().mockResolvedValue({ tag: 'stock-json' }),
      stats: jest.fn(),
      listForConsumer: jest.fn(),
    };
    controller = new IntegrationController(
      { relayBatch: jest.fn() } as any,
      queryService as any,
      { reconcileToday: jest.fn() } as any,
    );
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
