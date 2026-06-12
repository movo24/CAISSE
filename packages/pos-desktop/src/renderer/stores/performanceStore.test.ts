/**
 * performanceStore — cashier-session metrics accumulator. Tests assert the
 * store's REAL behaviour over the authorized scope: initial state, projections,
 * error/no-data handling, partial/inconsistent input.
 *
 * Observed-behaviour notes (not invented):
 *  - There are NO loading / success / error async states: this store is a local
 *    metrics ACCUMULATOR (localStorage + sync queue), not a data-fetching store.
 *    "loading/success/error" is therefore N/A — nothing to assert, and no hollow
 *    placeholder test is added for it (see report).
 *  - Time-based projections (getTicketsPerHour / getRevenuePerHour) read
 *    Date.now() via minutesSince(); the clock is frozen for those.
 *  - Sessions are seeded via setState so persist()/localStorage and uid() are not
 *    exercised here (those belong to a persistence-focused suite).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  usePerformanceStore,
  CashierSessionMetrics,
  TransactionRecord,
} from './performanceStore';

const tsAt = (hour: number, min = 0) => new Date(2026, 0, 5, hour, min, 0).toISOString();

const txn = (over: Partial<TransactionRecord> = {}): TransactionRecord => ({
  ticketNumber: 'T-1',
  timestamp: tsAt(10),
  totalMinorUnits: 1000,
  itemCount: 2,
  durationSeconds: 30,
  paymentMethod: 'cash' as any,
  discountMinorUnits: 0,
  wasVoided: false,
  ...over,
});

const session = (over: Partial<CashierSessionMetrics> = {}): CashierSessionMetrics => ({
  sessionId: 'sess-1',
  employeeId: 'e1',
  employeeName: 'Alice',
  storeId: 's1',
  sessionStartedAt: tsAt(9),
  totalRevenue: 0,
  totalDiscount: 0,
  ticketCount: 0,
  itemCount: 0,
  voidCount: 0,
  voidAmount: 0,
  totalTransactionSeconds: 0,
  fastestTransactionSeconds: Infinity,
  slowestTransactionSeconds: 0,
  highestTicket: 0,
  lowestTicket: Infinity,
  transactions: [],
  lastSyncedAt: null,
  ...over,
});

beforeEach(() => usePerformanceStore.setState({ session: null }));
afterEach(() => vi.useRealTimers());

describe('performanceStore — initial state & no-data handling', () => {
  it('starts with no session', () => {
    expect(usePerformanceStore.getState().session).toBeNull();
  });

  it('all computed selectors return safe zeros/empties with no session', () => {
    const s = usePerformanceStore.getState();
    expect(s.getAverageBasket()).toBe(0);
    expect(s.getAverageSpeed()).toBe(0);
    expect(s.getItemsPerMinute()).toBe(0);
    expect(s.getTicketsPerHour()).toBe(0);
    expect(s.getRevenuePerHour()).toBe(0);
    expect(s.getVoidRate()).toBe(0);
    expect(s.getHourlySplit()).toEqual([]);
  });

  it('recordTransaction / recordVoid are no-ops when there is no session', () => {
    const s = usePerformanceStore.getState();
    s.recordTransaction(txn());
    s.recordVoid('T-1', 1000);
    expect(usePerformanceStore.getState().session).toBeNull();
  });

  it('an empty session (0 tickets) yields zero averages, not NaN/Infinity', () => {
    usePerformanceStore.setState({ session: session() });
    const s = usePerformanceStore.getState();
    expect(s.getAverageBasket()).toBe(0); // guarded against /0
    expect(s.getAverageSpeed()).toBe(0);
    expect(s.getItemsPerMinute()).toBe(0); // guarded against totalSeconds 0
    expect(s.getVoidRate()).toBe(0);
  });
});

describe('performanceStore — initSession', () => {
  it('creates a zeroed session bound to the cashier', () => {
    usePerformanceStore.getState().initSession('emp-9', 'Bob', 'store-9');
    const s = usePerformanceStore.getState().session!;
    expect(s.employeeId).toBe('emp-9');
    expect(s.employeeName).toBe('Bob');
    expect(s.storeId).toBe('store-9');
    expect(s.ticketCount).toBe(0);
    expect(s.totalRevenue).toBe(0);
    expect(s.transactions).toEqual([]);
    expect(s.fastestTransactionSeconds).toBe(Infinity);
    expect(s.lowestTicket).toBe(Infinity);
  });
});

describe('performanceStore — recordTransaction (accumulation)', () => {
  it('accumulates counters and appends a non-voided record', () => {
    usePerformanceStore.setState({ session: session() });
    usePerformanceStore.getState().recordTransaction({
      ticketNumber: 'T-1',
      timestamp: tsAt(10),
      totalMinorUnits: 1500,
      itemCount: 3,
      durationSeconds: 40,
      paymentMethod: 'card' as any,
      discountMinorUnits: 200,
    });
    const s = usePerformanceStore.getState().session!;
    expect(s.totalRevenue).toBe(1500);
    expect(s.totalDiscount).toBe(200);
    expect(s.ticketCount).toBe(1);
    expect(s.itemCount).toBe(3);
    expect(s.totalTransactionSeconds).toBe(40);
    expect(s.fastestTransactionSeconds).toBe(40);
    expect(s.slowestTransactionSeconds).toBe(40);
    expect(s.highestTicket).toBe(1500);
    expect(s.lowestTicket).toBe(1500);
    expect(s.transactions).toHaveLength(1);
    expect(s.transactions[0].wasVoided).toBe(false);
  });

  it('aggregates two transactions (fastest/slowest, highest/lowest, sums)', () => {
    usePerformanceStore.setState({ session: session() });
    const st = usePerformanceStore.getState();
    st.recordTransaction({ ticketNumber: 'A', timestamp: tsAt(10), totalMinorUnits: 1000, itemCount: 1, durationSeconds: 20, paymentMethod: 'cash' as any, discountMinorUnits: 0 });
    st.recordTransaction({ ticketNumber: 'B', timestamp: tsAt(11), totalMinorUnits: 3000, itemCount: 4, durationSeconds: 60, paymentMethod: 'cash' as any, discountMinorUnits: 0 });
    const s = usePerformanceStore.getState().session!;
    expect(s.ticketCount).toBe(2);
    expect(s.totalRevenue).toBe(4000);
    expect(s.fastestTransactionSeconds).toBe(20);
    expect(s.slowestTransactionSeconds).toBe(60);
    expect(s.highestTicket).toBe(3000);
    expect(s.lowestTicket).toBe(1000);
  });
});

describe('performanceStore — recordVoid', () => {
  it('marks the matching transaction and increments void counters', () => {
    usePerformanceStore.setState({
      session: session({ ticketCount: 1, totalRevenue: 1000, transactions: [txn({ ticketNumber: 'T-1', totalMinorUnits: 1000 })] }),
    });
    usePerformanceStore.getState().recordVoid('T-1', 1000);
    const s = usePerformanceStore.getState().session!;
    expect(s.voidCount).toBe(1);
    expect(s.voidAmount).toBe(1000);
    expect(s.transactions[0].wasVoided).toBe(true);
  });

  // NOTE: the "recordVoid on an unknown ticketNumber" edge (previously documented
  // here as an ambiguity + it.todo asserting the old increment-anyway behaviour) is
  // RESOLVED by fix/frontend-store-business-rules (RULE 2 — recordVoid no-ops on an
  // unknown ticket). Its firm invariant lives in performanceStore.invariants.test.ts
  // on that branch; the old-behaviour assertion was removed here so this suite stays
  // consistent once the invariants PR is on main (it merges first).
});

describe('performanceStore — projections (deterministic)', () => {
  beforeEach(() => {
    usePerformanceStore.setState({
      session: session({
        ticketCount: 3,
        totalRevenue: 3000,
        itemCount: 6,
        totalTransactionSeconds: 90,
        voidCount: 1,
      }),
    });
  });

  it('getAverageBasket = round(totalRevenue / ticketCount)', () => {
    expect(usePerformanceStore.getState().getAverageBasket()).toBe(1000);
  });
  it('getAverageSpeed = round(totalTransactionSeconds / ticketCount)', () => {
    expect(usePerformanceStore.getState().getAverageSpeed()).toBe(30);
  });
  it('getItemsPerMinute = (itemCount / totalSeconds) × 60, .1-rounded', () => {
    expect(usePerformanceStore.getState().getItemsPerMinute()).toBe(4); // 6/90*60
  });
  it('getVoidRate = voidCount / (ticketCount + voidCount) × 100, .1-rounded', () => {
    expect(usePerformanceStore.getState().getVoidRate()).toBe(25); // 1/4
  });
});

describe('performanceStore — time-based projections (frozen clock)', () => {
  it('getTicketsPerHour / getRevenuePerHour project over the elapsed session', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 0, 5, 12, 0, 0)); // "now"
    usePerformanceStore.setState({
      session: session({
        sessionStartedAt: new Date(2026, 0, 5, 11, 0, 0).toISOString(), // 60 min ago
        ticketCount: 30,
        totalRevenue: 60000,
      }),
    });
    const s = usePerformanceStore.getState();
    expect(s.getTicketsPerHour()).toBe(30); // 30 tickets / 60 min × 60
    expect(s.getRevenuePerHour()).toBe(60000); // 60000 / 60 min × 60
  });
});

describe('performanceStore — getHourlySplit', () => {
  it('groups non-voided transactions by hour, excludes voided, sorted by hour', () => {
    usePerformanceStore.setState({
      session: session({
        transactions: [
          txn({ ticketNumber: 'A', timestamp: tsAt(14), totalMinorUnits: 2000, wasVoided: false }),
          txn({ ticketNumber: 'B', timestamp: tsAt(9), totalMinorUnits: 1000, wasVoided: false }),
          txn({ ticketNumber: 'C', timestamp: tsAt(9), totalMinorUnits: 500, wasVoided: true }), // excluded
        ],
      }),
    });
    expect(usePerformanceStore.getState().getHourlySplit()).toEqual([
      { hour: '9h', revenue: 1000, tickets: 1 },
      { hour: '14h', revenue: 2000, tickets: 1 },
    ]);
  });
});
