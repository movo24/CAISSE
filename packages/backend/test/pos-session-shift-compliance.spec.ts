import { PosSessionService } from '../src/modules/pos-session/pos-session.service';

/**
 * Conformité planning TW24 à l'ouverture de session — doctrine probant-only :
 * EMPLOYEE_SESSION_OPEN_AFTER_SHIFT_END n'est émis QUE si le feed fournit
 * endsAt + employeeId et que tous les shifts du jour sont terminés. Données
 * absentes/ambiguës ou TW24 down → aucun événement, ouverture jamais bloquée.
 */
describe('PosSessionService — shift compliance (probant only)', () => {
  const STORE = 'store-1';
  const EMP = 'emp-1';
  const TERMINAL = 'TERMINAL 02';

  const makeRepo = () => ({
    findOne: jest.fn().mockResolvedValue(null), // no active session on the terminal
    save: jest.fn(async (s: any) => Object.assign(s, { id: 'sess-1', openedAt: new Date() })),
  });

  const flush = () => new Promise((r) => setTimeout(r, 20));

  const openWith = async (todayShifts: unknown, opts: { failFeed?: boolean } = {}) => {
    const repo = makeRepo();
    const timewin = {
      pushEvent: jest.fn().mockResolvedValue(undefined),
      getTodayShifts: opts.failFeed
        ? jest.fn().mockRejectedValue(new Error('TW24 down'))
        : jest.fn().mockResolvedValue(todayShifts),
    };
    const scoreService = { logEvent: jest.fn().mockResolvedValue({}) };
    const svc = new PosSessionService(repo as any, timewin as any, undefined, scoreService as any);
    const session = await svc.openSession(STORE, EMP, { employeeName: 'Alice' }, { terminalId: TERMINAL });
    await flush(); // observeShiftCompliance is fire-and-forget
    return { session, scoreService };
  };

  const eventsOf = (scoreService: any, type: string) =>
    scoreService.logEvent.mock.calls.filter((c: any[]) => c[0]?.eventType === type);

  it('emits EMPLOYEE_SESSION_OPEN_AFTER_SHIFT_END when the feed proves the shift ended', async () => {
    const past = new Date(Date.now() - 2 * 3600 * 1000).toISOString();
    const { session, scoreService } = await openWith([
      { id: 's1', startsAt: new Date(Date.now() - 10 * 3600 * 1000).toISOString(), endsAt: past, employeeId: EMP },
    ]);
    const calls = eventsOf(scoreService, 'EMPLOYEE_SESSION_OPEN_AFTER_SHIFT_END');
    expect(calls).toHaveLength(1);
    expect(calls[0][0].sessionId).toBe(session.id); // rattaché à la session ouverte
    expect(calls[0][0].terminalId).toBe(TERMINAL);
  });

  it('emits NOTHING when the feed lacks endsAt (unknowable — no approximation)', async () => {
    const { scoreService } = await openWith([
      { id: 's1', startsAt: new Date(Date.now() - 10 * 3600 * 1000).toISOString(), employeeId: EMP },
    ]);
    expect(eventsOf(scoreService, 'EMPLOYEE_SESSION_OPEN_AFTER_SHIFT_END')).toHaveLength(0);
  });

  it('emits NOTHING when the feed lacks employeeId (name match is not probant)', async () => {
    const past = new Date(Date.now() - 2 * 3600 * 1000).toISOString();
    const { scoreService } = await openWith([
      { id: 's1', startsAt: new Date(Date.now() - 10 * 3600 * 1000).toISOString(), endsAt: past, employeeName: 'Alice' },
    ]);
    expect(eventsOf(scoreService, 'EMPLOYEE_SESSION_OPEN_AFTER_SHIFT_END')).toHaveLength(0);
  });

  it('emits NOTHING when a later shift is still open (coupure / double service)', async () => {
    const past = new Date(Date.now() - 2 * 3600 * 1000).toISOString();
    const future = new Date(Date.now() + 4 * 3600 * 1000).toISOString();
    const { scoreService } = await openWith([
      { id: 's1', startsAt: past, endsAt: past, employeeId: EMP },
      { id: 's2', startsAt: past, endsAt: future, employeeId: EMP },
    ]);
    expect(eventsOf(scoreService, 'EMPLOYEE_SESSION_OPEN_AFTER_SHIFT_END')).toHaveLength(0);
  });

  it('never blocks the session opening when TW24 is down', async () => {
    const { session, scoreService } = await openWith(undefined, { failFeed: true });
    expect(session.id).toBe('sess-1'); // session ouverte malgré TW24 down
    expect(eventsOf(scoreService, 'EMPLOYEE_SESSION_OPEN_AFTER_SHIFT_END')).toHaveLength(0);
  });
});
