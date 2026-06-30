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
      buildDayJournal: jest.fn().mockResolvedValue({ tag: 'j-day' }),
      buildDayJournalCsv: jest.fn().mockResolvedValue('j;day;csv'),
      buildJournalRange: jest.fn().mockResolvedValue({ tag: 'j-range' }),
      buildJournalRangeCsv: jest.fn().mockResolvedValue('j;range;csv'),
      buildSocialExport: jest.fn().mockResolvedValue({ tag: 'social' }),
      buildSocialExportCsv: jest.fn().mockResolvedValue('social;csv'),
    };
    controller = new ComptamaxController(svc as any);
  });

  it('GET /journal (day, json) uses JWT storeId', async () => {
    await controller.journal(req, '2026-06-29');
    expect(svc.buildDayJournal).toHaveBeenCalledWith('store-JWT', '2026-06-29');
  });

  it('GET /journal?from&to routes to the range variant (JWT storeId)', async () => {
    await controller.journal(req, '', undefined, '2026-06-01', '2026-06-30');
    expect(svc.buildJournalRange).toHaveBeenCalledWith('store-JWT', '2026-06-01', '2026-06-30');
    expect(svc.buildDayJournal).not.toHaveBeenCalled();
  });

  it('GET /journal?from&to&format=csv routes to range CSV', async () => {
    const out = await controller.journal(req, '', 'csv', '2026-06-01', '2026-06-30');
    expect(svc.buildJournalRangeCsv).toHaveBeenCalledWith('store-JWT', '2026-06-01', '2026-06-30');
    expect(out).toBe('j;range;csv');
  });

  it('GET /journal?format=csv (day) routes to day CSV', async () => {
    await controller.journal(req, '2026-06-29', 'csv');
    expect(svc.buildDayJournalCsv).toHaveBeenCalledWith('store-JWT', '2026-06-29');
  });

  it('GET /social (json) uses JWT storeId', async () => {
    await controller.social(req, '2026-06');
    expect(svc.buildSocialExport).toHaveBeenCalledWith('store-JWT', '2026-06');
  });

  it('GET /social?format=csv routes to CSV variant', async () => {
    const out = await controller.social(req, '2026-06', 'csv');
    expect(svc.buildSocialExportCsv).toHaveBeenCalledWith('store-JWT', '2026-06');
    expect(out).toBe('social;csv');
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
