import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { EmployeeScoreService } from './employee-score.service';
import { EmployeeScoreEventEntity } from '../../database/entities/employee-score-event.entity';
import { EmployeeScoreRuleEntity } from '../../database/entities/employee-score-rule.entity';
import { EmployeeScoreDailyEntity } from '../../database/entities/employee-score-daily.entity';
import { PosSessionEntity } from '../../database/entities/pos-session.entity';
import { AuditService } from '../audit/audit.service';
import { DEFAULT_SCORE_RULES, scoreColor } from './employee-score.constants';

const EMP = 'emp-1';
const STORE = 'store-1';
// Fixed anchor: midday UTC = midday Paris (same calendar date in both zones,
// away from any DST edge). Deterministic regardless of wall-clock — the day
// window [Paris-midnight .. now] always contains events stamped at this instant.
const NOW = new Date('2026-03-16T12:00:00Z');

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
  let sessionRepo: any;

  const build = async (seed: any[] = [], activeSession: any = null) => {
    eventRepo = makeEventRepo(seed);
    dailyRepo = {
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn((d: any) => ({ ...d })),
      save: jest.fn(async (d: any) => ({ id: 'daily-1', ...d })),
    };
    // findActiveForTerminal-equivalent: returns the seeded active session when
    // (storeId, terminalId, isActive) match, else null.
    sessionRepo = {
      _active: activeSession,
      findOne: jest.fn(async (opts: any) => {
        const w = opts?.where || {};
        const s = sessionRepo._active;
        if (!s) return null;
        if (w.storeId && w.storeId !== s.storeId) return null;
        if (w.terminalId && w.terminalId !== s.terminalId) return null;
        return s;
      }),
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EmployeeScoreService,
        { provide: getRepositoryToken(EmployeeScoreEventEntity), useValue: eventRepo },
        { provide: getRepositoryToken(EmployeeScoreRuleEntity), useValue: { find: jest.fn().mockResolvedValue([]) } },
        { provide: getRepositoryToken(EmployeeScoreDailyEntity), useValue: dailyRepo },
        { provide: getRepositoryToken(PosSessionEntity), useValue: sessionRepo },
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
    const now = NOW;
    await build([
      { id: 'e1', employeeId: EMP, storeId: STORE, eventType: 'CASH_DIFFERENCE_MAJOR', category: 'cash', pointsDelta: -10, createdAt: now },
    ]);
    const s = await service.getScore(EMP, 'day', now);
    expect(s.categories.cash.score).toBe(15); // 25 - 10
    expect(s.total).toBe(90);
    expect(s.color).toBe(scoreColor(90)); // green (>=85)
  });

  it('caps repeated penalties of the same type per day (maxDailyPenalty)', async () => {
    const now = NOW;
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
    const now = NOW;
    await build([
      { id: 'a1', employeeId: EMP, storeId: STORE, eventType: 'SESSION_ABANDONED', category: 'session', pointsDelta: -8, createdAt: now },
    ]);
    const s = await service.getScore(EMP, 'day', now);
    expect(s.categories.session.score).toBe(17); // 25 - 8
  });

  it('computes day, week and year summaries', async () => {
    const now = NOW;
    await build([
      { id: 'e1', employeeId: EMP, storeId: STORE, eventType: 'CASH_DIFFERENCE_MINOR', category: 'cash', pointsDelta: -3, createdAt: now },
    ]);
    const summary = await service.getScoreSummary(EMP, now);
    expect(summary.day.total).toBe(97);
    expect(summary.week.total).toBe(97);
    expect(summary.year.total).toBe(97);
  });

  it('recomputeDaily upserts an aggregate row', async () => {
    const now = NOW;
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

  // ── Server-side session guard (Fiabilité d'abord) ──────────────

  const activeSession = { id: 'sess-1', storeId: STORE, terminalId: 'T2', employeeId: EMP, isActive: true };

  it('accepts a sensitive event when the sessionId matches the terminal active session', async () => {
    await build([], activeSession);
    const ev = await service.logEvent({
      employeeId: EMP, storeId: STORE, eventType: 'DISCOUNT_ABOVE_LIMIT',
      terminalId: 'T2', sessionId: 'sess-1', enforceSession: true,
    });
    expect(ev!.eventType).toBe('DISCOUNT_ABOVE_LIMIT');
    expect(ev!.pointsDelta).toBe(DEFAULT_SCORE_RULES.DISCOUNT_ABOVE_LIMIT.pointsDelta);
  });

  it('downgrades a sensitive event with a spoofed sessionId to ACTION_WITHOUT_VALID_SESSION', async () => {
    await build([], activeSession);
    const ev = await service.logEvent({
      employeeId: EMP, storeId: STORE, eventType: 'REFUND_WITHOUT_REASON',
      terminalId: 'T2', sessionId: 'not-the-active-one', enforceSession: true,
    });
    expect(ev!.eventType).toBe('ACTION_WITHOUT_VALID_SESSION');
    expect(ev!.pointsDelta).toBe(DEFAULT_SCORE_RULES.ACTION_WITHOUT_VALID_SESSION.pointsDelta); // -15
    expect(ev!.category).toBe('session');
    expect((ev!.metadata as any).claimedEventType).toBe('REFUND_WITHOUT_REASON');
    expect((ev!.metadata as any).claimedSessionId).toBe('not-the-active-one');
  });

  it('downgrades a sensitive event when no session is provided at all', async () => {
    await build([], activeSession);
    const ev = await service.logEvent({
      employeeId: EMP, storeId: STORE, eventType: 'CASH_DRAWER_OPENED_MANUALLY',
      terminalId: 'T2', sessionId: null, enforceSession: true,
    });
    expect(ev!.eventType).toBe('ACTION_WITHOUT_VALID_SESSION');
  });

  it('downgrades when the active session belongs to another employee', async () => {
    await build([], { ...activeSession, employeeId: 'other-emp' });
    const ev = await service.logEvent({
      employeeId: EMP, storeId: STORE, eventType: 'SALE_VOIDED',
      terminalId: 'T2', sessionId: 'sess-1', enforceSession: true,
    });
    expect(ev!.eventType).toBe('ACTION_WITHOUT_VALID_SESSION');
  });

  it('does NOT enforce sessions for session-lifecycle events (SESSION_OPENED)', async () => {
    await build([], null);
    const ev = await service.logEvent({
      employeeId: EMP, storeId: STORE, eventType: 'SESSION_OPENED',
      terminalId: 'T2', sessionId: 'sess-1', enforceSession: true,
    });
    expect(ev!.eventType).toBe('SESSION_OPENED');
  });

  it('does NOT enforce sessions for backend-authoritative callers (enforceSession off)', async () => {
    await build([], null);
    const ev = await service.logEvent({
      employeeId: EMP, storeId: STORE, eventType: 'DISCOUNT_ABOVE_LIMIT',
      terminalId: 'T2', sessionId: 'whatever',
    });
    expect(ev!.eventType).toBe('DISCOUNT_ABOVE_LIMIT');
  });

  it('keeps the original event (not an anomaly) when the session read fails (unverifiable)', async () => {
    await build([], activeSession);
    sessionRepo.findOne.mockRejectedValueOnce(new Error('db timeout'));
    const ev = await service.logEvent({
      employeeId: EMP, storeId: STORE, eventType: 'DISCOUNT_ABOVE_LIMIT',
      terminalId: 'T2', sessionId: 'sess-1', enforceSession: true,
    });
    expect(ev!.eventType).toBe('DISCOUNT_ABOVE_LIMIT');
    expect((ev!.metadata as any).sessionVerification).toBe('unverifiable');
  });
});
