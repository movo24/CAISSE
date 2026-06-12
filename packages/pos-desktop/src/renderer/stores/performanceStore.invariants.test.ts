/**
 * performanceStore BUSINESS INVARIANT — a void must reference a known ticket.
 *
 * Decision: recordVoid() on a ticketNumber that matches no recorded transaction
 * is a clean no-op — voidCount, voidAmount and getVoidRate stay UNCHANGED, and no
 * phantom ticket is created. A void targeting a known ticket behaves as before.
 * (Resolves the ambiguity previously flagged on test/frontend-stores-coverage.)
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  usePerformanceStore,
  CashierSessionMetrics,
  TransactionRecord,
} from './performanceStore';

const txn = (over: Partial<TransactionRecord> = {}): TransactionRecord => ({
  ticketNumber: 'T-1',
  timestamp: new Date(2026, 0, 5, 10, 0, 0).toISOString(),
  totalMinorUnits: 1000,
  itemCount: 1,
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
  sessionStartedAt: new Date(2026, 0, 5, 9, 0, 0).toISOString(),
  totalRevenue: 0,
  totalDiscount: 0,
  ticketCount: 3,
  itemCount: 0,
  voidCount: 1, // one legitimate prior void already on record
  voidAmount: 1000,
  totalTransactionSeconds: 0,
  fastestTransactionSeconds: Infinity,
  slowestTransactionSeconds: 0,
  highestTicket: 0,
  lowestTicket: Infinity,
  transactions: [txn({ ticketNumber: 'T-1' })],
  lastSyncedAt: null,
  ...over,
});

beforeEach(() => usePerformanceStore.setState({ session: null }));

describe('performanceStore invariant — a void must reference a known ticket', () => {
  it('UNKNOWN ticketNumber → voidCount, voidAmount and voidRate all unchanged (no-op)', () => {
    usePerformanceStore.setState({ session: session() });
    const rateBefore = usePerformanceStore.getState().getVoidRate(); // 1/(3+1)=25

    usePerformanceStore.getState().recordVoid('T-DOES-NOT-EXIST', 500);

    const s = usePerformanceStore.getState().session!;
    expect(s.voidCount).toBe(1); // NOT incremented
    expect(s.voidAmount).toBe(1000); // NOT incremented
    expect(usePerformanceStore.getState().getVoidRate()).toBe(rateBefore); // unchanged
    // no phantom ticket created, nothing newly marked
    expect(s.transactions).toHaveLength(1);
    expect(s.transactions.every((t) => t.ticketNumber !== 'T-DOES-NOT-EXIST')).toBe(true);
  });

  it('KNOWN ticketNumber → still voids correctly (behaviour preserved)', () => {
    usePerformanceStore.setState({ session: session({ voidCount: 0, voidAmount: 0 }) });
    usePerformanceStore.getState().recordVoid('T-1', 1000);
    const s = usePerformanceStore.getState().session!;
    expect(s.voidCount).toBe(1);
    expect(s.voidAmount).toBe(1000);
    expect(s.transactions.find((t) => t.ticketNumber === 'T-1')!.wasVoided).toBe(true);
  });
});
