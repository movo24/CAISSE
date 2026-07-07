import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { EmployeeScoreService } from './employee-score.service';
import { EmployeeScoreEventEntity } from '../../database/entities/employee-score-event.entity';
import { EmployeeScoreRuleEntity } from '../../database/entities/employee-score-rule.entity';
import { EmployeeScoreDailyEntity } from '../../database/entities/employee-score-daily.entity';
import { AuditService } from '../audit/audit.service';
import { DEFAULT_SCORE_RULES, scoreColor } from './employee-score.constants';

const EMP = 'emp-1';
const STORE = 'store-1';

/** In-memory event store driving both save and the range queries. */
function makeEventRepo(seed: any[] = []) {
  const rows: any[] = [...seed];
  return {
    _rows: rows,
    create: jest.fn((d: any) => ({ ...d })),
    save: jest.fn(async (d: any) => {
      const row = { id: `ev-${rows.length + 1}`, createdAt: d.createdAt || new Date(), ...d };
      rows.push(row);
      return row;
    }),
    find: jest.fn(async (opts: any) => {
      // Supports { where: { employeeId, createdAt: Between(start,end) }, order }
      const w = opts?.where || {};
      let out = rows.filter((r) => (w.employeeId ? r.employeeId === w.employeeId : true));
      if (w.createdAt && w.createdAt._type === 'between') {
        const [start, end] = w.createdAt._value;
        out = out.filter((r) => r.createdAt >= start && r.createdAt <= end);
      }
      if (opts?.take) out = out.slice(0, opts.take);
      return out;
    }),
    createQueryBuilder: jest.fn(() => {
      const qb: any = {
        _where: [] as any[],
        select: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        groupBy: jest.fn().mockReturnThis(),
        addGroupBy: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        getMany: jest.fn(async () => rows),
        getRawMany: jest.fn(async () => {
          const seen = new Set<string>();
          const res: any[] = [];
          for (const r of rows) {
            const k = `${r.employeeId}|${r.storeId}`;
            if (!seen.has(k)) { seen.add(k); res.push({ employeeId: r.employeeId, storeId: r.storeId }); }
          }
          return res;
        }),
      };
      return qb;
    }),
  };
}

// Minimal Between marker compatible with the repo mock above.
jest.mock('typeorm', () => {
  const actual = jest.requireActual('typeorm');
  return { ...actual, Between: (a: any, b: any) => ({ _type: 'between', _value: [a, b] }) };
});

describe('EmployeeScoreService', () => {
  let service: EmployeeScoreService;
  let eventRepo: any;
  let dailyRepo: any;

  const build = async (seed: any[] = []) => {
    eventRepo = makeEventRepo(seed);
    dailyRepo = {
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn((d: any) => ({ ...d })),
      save: jest.fn(async (d: any) => ({ id: 'daily-1', ...d })),
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EmployeeScoreService,
        { provide: getRepositoryToken(EmployeeScoreEventEntity), useValue: eventRepo },
        { provide: getRepositoryToken(EmployeeScoreRuleEntity), useValue: { find: jest.fn().mockResolvedValue([]) } },
        { provide: getRepositoryToken(EmployeeScoreDailyEntity), useValue: dailyRepo },
        { provide: AuditService, useValue: { log: jest.fn().mockResolvedValue({}) } },
      ],
    }).compile();
    service = module.get(EmployeeScoreService);
  };

  it('perfect score (100, green) when there are no events', async () => {
    await build([]);
    const s = await service.getScore(EMP, 'day');
    expect(s.total).toBe(100);
    expect(s.color).toBe('green');
    expect(s.categories.cash.score).toBe(25);
  });

  it('logs an event with the resolved rule points + mirrors to audit', async () => {
    await build([]);
    const ev = await service.logEvent({
      employeeId: EMP, storeId: STORE, eventType: 'CASH_DIFFERENCE_MAJOR', terminalId: 'T2', sessionId: undefined,
    });
    expect(ev).toBeTruthy();
    expect(ev!.pointsDelta).toBe(DEFAULT_SCORE_RULES.CASH_DIFFERENCE_MAJOR.pointsDelta); // -10
    expect(ev!.category).toBe('cash');
  });

  it('a major cash difference drops the cash category and total', async () => {
    const now = new Date();
    await build([
      { id: 'e1', employeeId: EMP, storeId: STORE, eventType: 'CASH_DIFFERENCE_MAJOR', category: 'cash', pointsDelta: -10, createdAt: now },
    ]);
    const s = await service.getScore(EMP, 'day', now);
    expect(s.categories.cash.score).toBe(15); // 25 - 10
    expect(s.total).toBe(90);
    expect(s.color).toBe(scoreColor(90)); // green (>=85)
  });

  it('caps repeated penalties of the same type per day (maxDailyPenalty)', async () => {
    const now = new Date();
    // VOID_WITHOUT_REASON = -4, maxDailyPenalty 12 → 5 of them would be -20 but capped to -12.
    const seed = Array.from({ length: 5 }, (_, i) => ({
      id: `v${i}`, employeeId: EMP, storeId: STORE, eventType: 'VOID_WITHOUT_REASON',
      category: 'procedure', pointsDelta: -4, createdAt: now,
    }));
    await build(seed);
    const s = await service.getScore(EMP, 'day', now);
    expect(s.categories.procedure.score).toBe(8); // 20 - 12 (capped), not 20 - 20
  });

  it('a session abandoned event penalises the session category', async () => {
    const now = new Date();
    await build([
      { id: 'a1', employeeId: EMP, storeId: STORE, eventType: 'SESSION_ABANDONED', category: 'session', pointsDelta: -8, createdAt: now },
    ]);
    const s = await service.getScore(EMP, 'day', now);
    expect(s.categories.session.score).toBe(17); // 25 - 8
  });

  it('computes day, week and year summaries', async () => {
    const now = new Date();
    await build([
      { id: 'e1', employeeId: EMP, storeId: STORE, eventType: 'CASH_DIFFERENCE_MINOR', category: 'cash', pointsDelta: -3, createdAt: now },
    ]);
    const summary = await service.getScoreSummary(EMP, now);
    expect(summary.day.total).toBe(97);
    expect(summary.week.total).toBe(97);
    expect(summary.year.total).toBe(97);
  });

  it('recomputeDaily upserts an aggregate row', async () => {
    const now = new Date();
    const day = now.toISOString().slice(0, 10);
    await build([
      { id: 'e1', employeeId: EMP, storeId: STORE, eventType: 'CASH_DIFFERENCE_MINOR', category: 'cash', pointsDelta: -3, createdAt: now },
    ]);
    await service.recomputeDaily(EMP, STORE, day, now);
    expect(dailyRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ employeeId: EMP, storeId: STORE, scoreDate: day, cashScore: 22 }),
    );
  });

  it('never throws on logEvent failure (returns null)', async () => {
    await build([]);
    eventRepo.save.mockRejectedValueOnce(new Error('db down'));
    const ev = await service.logEvent({ employeeId: EMP, storeId: STORE, eventType: 'SALE_VOIDED' });
    expect(ev).toBeNull();
  });
});
