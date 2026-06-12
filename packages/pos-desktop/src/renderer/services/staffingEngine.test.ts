/**
 * Pure-logic coverage for the staffing engine's computed selectors — the
 * hour→target mapping and the load/capacity/revenue projections. These read
 * `new Date()` (current hour/minute), so the clock is frozen with fake timers to
 * make every assertion deterministic. No intervals/localStorage are touched
 * (those only start via `start()` / `persist()`, never called here).
 */
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { useStaffingStore } from './staffingEngine';

// Freeze the wall clock to a fixed date at hour h, minute m.
const freezeAt = (h: number, m = 0) => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 0, 5, h, m, 0, 0));
};

const cashiers = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    cashierId: `c${i}`,
    cashierName: `C${i}`,
    sessionOpenedAt: new Date(2026, 0, 5, 9, 0, 0).toISOString(),
    txCount: 0,
  })) as any;

beforeEach(() => {
  // Reset the live fields the selectors read; keep the default hourly targets.
  useStaffingStore.setState({
    activeCashiers: [],
    currentHourTx: 0,
    currentHourRevenue: 0,
  });
});
afterEach(() => vi.useRealTimers());

describe('staffingEngine — getCurrentTarget (hour → default target)', () => {
  it('lunch peak 12–14h → 550€ target, 30 tx/cashier capacity', () => {
    freezeAt(13);
    const t = useStaffingStore.getState().getCurrentTarget();
    expect(t.revenueTarget).toBe(55000);
    expect(t.txCapacity).toBe(30);
  });

  it('quiet morning 9–12h → 300€, 20 tx', () => {
    freezeAt(10);
    const t = useStaffingStore.getState().getCurrentTarget();
    expect(t.revenueTarget).toBe(30000);
    expect(t.txCapacity).toBe(20);
  });

  it('evening peak 17–20h → 600€, 30 tx', () => {
    freezeAt(18);
    const t = useStaffingStore.getState().getCurrentTarget();
    expect(t.revenueTarget).toBe(60000);
    expect(t.txCapacity).toBe(30);
  });

  it('off-hours (e.g. 03h) → no revenue target, default 20 capacity', () => {
    freezeAt(3);
    const t = useStaffingStore.getState().getCurrentTarget();
    expect(t.revenueTarget).toBe(0);
    expect(t.txCapacity).toBe(20);
  });
});

describe('staffingEngine — getCapacityRate (projected load / capacity, 0–1)', () => {
  it('projects current-hour tx to a full hour vs capacity', () => {
    freezeAt(13, 30); // lunch (cap 30), 30 min in
    useStaffingStore.setState({ currentHourTx: 10, activeCashiers: cashiers(1) });
    // projected = 10/30*60 = 20 tx/h ; capacity = 30*1 = 30 → 20/30
    expect(useStaffingStore.getState().getCapacityRate()).toBeCloseTo(20 / 30, 6);
  });

  it('caps at 1 when projection exceeds capacity', () => {
    freezeAt(13, 30);
    useStaffingStore.setState({ currentHourTx: 30, activeCashiers: cashiers(1) });
    // projected = 60 tx/h ; capacity 30 → 2.0 → min(1, …) = 1
    expect(useStaffingStore.getState().getCapacityRate()).toBe(1);
  });

  it('is 0 with no transactions yet', () => {
    freezeAt(13, 30);
    useStaffingStore.setState({ currentHourTx: 0, activeCashiers: cashiers(2) });
    expect(useStaffingStore.getState().getCapacityRate()).toBe(0);
  });
});

describe('staffingEngine — getRevenueRate (projected revenue / target, capped 2)', () => {
  it('on-track projection lands at 1.0', () => {
    freezeAt(13, 30); // target 55000
    useStaffingStore.setState({ currentHourRevenue: 27500 }); // 27500/30*60 = 55000
    expect(useStaffingStore.getState().getRevenueRate()).toBeCloseTo(1, 6);
  });

  it('caps overshoot at 2.0 (200%)', () => {
    freezeAt(13, 30);
    useStaffingStore.setState({ currentHourRevenue: 100000 }); // way over → projected 200000 → 3.6 → cap 2
    expect(useStaffingStore.getState().getRevenueRate()).toBe(2);
  });

  it('returns 1 ("on track") when the hour has no revenue target', () => {
    freezeAt(3, 30); // off-hours, target 0
    useStaffingStore.setState({ currentHourRevenue: 99999 });
    expect(useStaffingStore.getState().getRevenueRate()).toBe(1);
  });
});

describe('staffingEngine — getTxPerHourPerCashier', () => {
  it('projects per-cashier hourly rate (rounded to .1)', () => {
    freezeAt(13, 30);
    useStaffingStore.setState({ currentHourTx: 15, activeCashiers: cashiers(2) });
    // 15 / 2 / 30 * 60 = 15.0
    expect(useStaffingStore.getState().getTxPerHourPerCashier()).toBeCloseTo(15, 6);
  });

  it('is 0 with no active cashiers', () => {
    useStaffingStore.setState({ activeCashiers: [] });
    expect(useStaffingStore.getState().getTxPerHourPerCashier()).toBe(0);
  });
});
