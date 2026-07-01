import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { ComptamaxService } from './comptamax.service';
import { IntegrationEventEntity } from '../../database/entities/integration-event.entity';
import { TimewinService } from '../timewin/timewin.service';

// PAQUET 270 — Comptamax journal / cash-control read model. DI-mocked outbox.
// Locks the event-query contract (store + day/range + event-type filter) and the
// range/cash-control assembly. Accounting maths live in the pure journal/
// cash-control helper specs; here we lock the query + shape.

describe('ComptamaxService — journal & cash-control', () => {
  let service: ComptamaxService;
  let events: { find: jest.Mock };

  beforeEach(async () => {
    events = { find: jest.fn().mockResolvedValue([]) };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ComptamaxService,
        { provide: getRepositoryToken(IntegrationEventEntity), useValue: events },
        { provide: TimewinService, useValue: {} },
      ],
    }).compile();
    service = module.get(ComptamaxService);
  });

  it('buildDayJournal queries the store + day and returns an empty journal for no events', async () => {
    const j = await service.buildDayJournal('s1', '2026-06-07');
    expect(j).toMatchObject({ storeId: 's1', date: '2026-06-07' });
    expect(Array.isArray(j.lines)).toBe(true);
    expect(j.lines).toHaveLength(0);
    const where = events.find.mock.calls[0][0].where;
    expect(where.storeId).toBe('s1');
    expect(where.occurredAt).toBeDefined(); // Between(start,end)
    expect(where.type).toBeDefined(); // In([...revenue event types])
  });

  it('buildJournalRange labels the period from..to', async () => {
    const j = await service.buildJournalRange('s1', '2026-06-01', '2026-06-30');
    expect(j).toMatchObject({ storeId: 's1', from: '2026-06-01', to: '2026-06-30', date: '2026-06-01..2026-06-30' });
  });

  it('buildCashControl counts Z-reports and captured payments from the day events', async () => {
    events.find.mockResolvedValue([
      { type: 'payment.captured', payload: { method: 'card', amountMinorUnits: 1000 } },
      { type: 'cash_session.closed', payload: { cashTotalMinorUnits: 500, cardTotalMinorUnits: 1000, totalRevenueMinorUnits: 1500 } },
    ]);
    const r = await service.buildCashControl('s1', '2026-06-07');
    expect(r).toMatchObject({ storeId: 's1', date: '2026-06-07', zReportCount: 1 });
    const where = events.find.mock.calls[0][0].where;
    expect(where.storeId).toBe('s1');
    expect(where.type).toBeDefined(); // In(['payment.captured','cash_session.closed'])
  });
});
