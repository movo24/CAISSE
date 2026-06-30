import { describe, it, expect } from 'vitest';
import { manualDiscountGuard } from './manual-discount-guard';

describe('manualDiscountGuard (POS-FE-159)', () => {
  it('allows manual discount when online', () => {
    expect(manualDiscountGuard({ isOffline: false })).toEqual({ allowed: true });
  });

  it('blocks manual discount when offline with a clear reason', () => {
    const r = manualDiscountGuard({ isOffline: true });
    expect(r.allowed).toBe(false);
    expect(r.reason).toMatch(/hors-ligne/i);
    expect(r.reason).toMatch(/code responsable/i);
  });
});
