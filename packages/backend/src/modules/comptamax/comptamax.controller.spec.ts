import { ComptamaxController } from './comptamax.controller';

/**
 * POS-INT-124 — routing smoke test (no DB, no Nest container).
 * Proves cash-control delegates to the service with the JWT storeId (anti-IDOR)
 * and honors the format switch.
 */
describe('ComptamaxController — routing (POS-INT-124)', () => {
  const req = { user: { storeId: 'store-JWT' } };
  let svc: any;
  let controller: ComptamaxController;

  beforeEach(() => {
    svc = {
      buildCashControl: jest.fn().mockResolvedValue({ tag: 'cc-json' }),
      buildCashControlCsv: jest.fn().mockResolvedValue('bucket;...'),
      buildDayJournal: jest.fn(),
      buildSocialExport: jest.fn(),
    };
    controller = new ComptamaxController(svc as any);
  });

  it('GET /cash-control (json) uses JWT storeId, not the query', async () => {
    await controller.cashControl(req, '2026-06-29');
    expect(svc.buildCashControl).toHaveBeenCalledWith('store-JWT', '2026-06-29');
    expect(svc.buildCashControlCsv).not.toHaveBeenCalled();
  });

  it('GET /cash-control?format=csv routes to the CSV variant', async () => {
    const out = await controller.cashControl(req, '2026-06-29', 'csv');
    expect(svc.buildCashControlCsv).toHaveBeenCalledWith('store-JWT', '2026-06-29');
    expect(out).toBe('bucket;...');
  });
});
