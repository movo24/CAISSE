import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { ReconciliationService } from './reconciliation.service';
import { PosSessionEntity } from '../../database/entities/pos-session.entity';
import { TimewinService } from '../timewin/timewin.service';

// PAQUET 259 — POS↔TimeWin presence reconciliation. DI-mocked. The key contract
// is graceful degradation: if TimeWin is unreachable, reconciliation still runs on
// POS-only data and flags timewinReachable=false (never blocks the caisse).

describe('ReconciliationService', () => {
  let service: ReconciliationService;
  let sessions: { find: jest.Mock };
  let timewin: { getTodayShifts: jest.Mock };

  beforeEach(async () => {
    sessions = { find: jest.fn() };
    timewin = { getTodayShifts: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReconciliationService,
        { provide: getRepositoryToken(PosSessionEntity), useValue: sessions },
        { provide: TimewinService, useValue: timewin },
      ],
    }).compile();

    service = module.get(ReconciliationService);
  });

  it('reports timewinReachable=true and the POS session count on the happy path', async () => {
    sessions.find.mockResolvedValue([
      { openedAt: new Date('2026-06-07T09:00:00Z'), closedAt: new Date('2026-06-07T17:00:00Z') },
    ]);
    timewin.getTodayShifts.mockResolvedValue([]);
    const res = await service.reconcileToday('store-1');
    expect(res.timewinReachable).toBe(true);
    expect(res.posSessionCount).toBe(1);
    expect(res.storeId).toBe('store-1');
    expect(res.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('degrades gracefully when TimeWin throws: timewinReachable=false, still returns POS-only result', async () => {
    sessions.find.mockResolvedValue([
      { openedAt: new Date('2026-06-07T09:00:00Z'), closedAt: null },
    ]);
    timewin.getTodayShifts.mockRejectedValue(new Error('circuit open'));
    const res = await service.reconcileToday('store-1');
    expect(res.timewinReachable).toBe(false);
    expect(res.posSessionCount).toBe(1);
  });

  it('scopes the session query by employeeId when provided', async () => {
    sessions.find.mockResolvedValue([]);
    timewin.getTodayShifts.mockResolvedValue([]);
    const res = await service.reconcileToday('store-1', 'emp-9');
    expect(res.employeeId).toBe('emp-9');
    expect(sessions.find).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ storeId: 'store-1', employeeId: 'emp-9' }) }),
    );
  });
});
