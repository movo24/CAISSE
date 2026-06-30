import { describe, it, expect } from 'vitest';
import { summarizeSupervision } from './supervisionVerdict';

describe('summarizeSupervision (POS-FE-164)', () => {
  it('all nominal → ok', () => {
    const v = summarizeSupervision({
      health: { status: 'ok', database: 'up', timewin: 'up' },
      outbox: { failed: 0, pending: 2 },
      reconciliation: { timewinReachable: true, discrepancies: [] },
      stock: { depletedCount: 0, lowCount: 3 },
    });
    expect(v.level).toBe('ok');
    expect(v.reasons).toEqual([]);
  });

  it('DB down → critical', () => {
    const v = summarizeSupervision({ health: { status: 'down', database: 'down' } });
    expect(v.level).toBe('critical');
    expect(v.reasons.join(' ')).toMatch(/indisponible/i);
  });

  it('outbox failures → critical (outranks watch signals)', () => {
    const v = summarizeSupervision({
      health: { status: 'degraded' },
      outbox: { failed: 3 },
      stock: { depletedCount: 5 },
    });
    expect(v.level).toBe('critical');
  });

  it('degraded + discrepancies + ruptures → watch', () => {
    const v = summarizeSupervision({
      health: { status: 'degraded', database: 'up', timewin: 'up' },
      outbox: { failed: 0, pending: 1 },
      reconciliation: { timewinReachable: true, discrepancies: [{}, {}] },
      stock: { depletedCount: 2 },
    });
    expect(v.level).toBe('watch');
    expect(v.reasons.length).toBeGreaterThanOrEqual(3);
  });

  it('high pending outbox alone → watch', () => {
    expect(summarizeSupervision({ outbox: { pending: 120, failed: 0 } }).level).toBe('watch');
  });

  it('empty input → ok', () => {
    expect(summarizeSupervision({}).level).toBe('ok');
  });
});
