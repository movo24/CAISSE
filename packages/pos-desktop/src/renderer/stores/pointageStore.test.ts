import { describe, it, expect, beforeEach } from 'vitest';
import { usePointageStore } from './pointageStore';

const s = () => usePointageStore.getState();

describe('pointageStore — shift / break transitions', () => {
  beforeEach(() => { localStorage.clear(); usePointageStore.setState({ currentShift: null }); });

  it('clock-in opens a shift, not on break', () => {
    s().clockIn('e1', 'Alice', 'store-1');
    expect(s().currentShift).not.toBeNull();
    expect(s().isOnBreak()).toBe(false);
    expect(s().currentShift!.totalBreakMinutes).toBe(0);
  });

  it('start/end break toggles on-break and accumulates non-negative break time', () => {
    s().clockIn('e1', 'Alice', 'store-1');
    s().startBreak();
    expect(s().isOnBreak()).toBe(true);
    s().startBreak(); // double start is a no-op
    expect(s().isOnBreak()).toBe(true);
    s().endBreak();
    expect(s().isOnBreak()).toBe(false);
    expect(s().currentShift!.totalBreakMinutes).toBeGreaterThanOrEqual(0);
  });

  it('end break without an active break is a no-op', () => {
    s().clockIn('e1', 'Alice', 'store-1');
    expect(() => s().endBreak()).not.toThrow();
    expect(s().currentShift!.breakStartAt).toBeNull();
  });

  it('clock-out closes the shift (auto-ending any open break)', () => {
    s().clockIn('e1', 'Alice', 'store-1');
    s().startBreak();
    s().clockOut();
    expect(s().currentShift).toBeNull();
  });

  it('duration getters are 0 with no shift and non-negative during a shift', () => {
    expect(s().getShiftDurationMinutes()).toBe(0);
    expect(s().getBreakMinutes()).toBe(0);
    s().clockIn('e1', 'Alice', 'store-1');
    expect(s().getShiftDurationMinutes()).toBeGreaterThanOrEqual(0);
    expect(s().getBreakMinutes()).toBeGreaterThanOrEqual(0);
  });
});
