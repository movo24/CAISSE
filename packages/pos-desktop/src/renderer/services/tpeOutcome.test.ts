import { describe, it, expect } from 'vitest';
import { decideTpeOutcome } from './tpeOutcome';

describe('decideTpeOutcome (M601 — TPE card result)', () => {
  it('SUCCESS + quick → finalizes the whole ticket as one card tender', () => {
    expect(decideTpeOutcome('success', 'quick')).toEqual({ finalizesSale: true, mode: 'quick' });
  });

  it('SUCCESS + split → commits a partial card tender', () => {
    expect(decideTpeOutcome('success', 'split')).toEqual({ finalizesSale: true, mode: 'split' });
  });

  it('REFUSED never finalizes (decision-6: no paid without capture)', () => {
    expect(decideTpeOutcome('refused', 'quick')).toEqual({ finalizesSale: false, mode: null });
    expect(decideTpeOutcome('refused', 'split')).toEqual({ finalizesSale: false, mode: null });
  });

  it('TIMEOUT never finalizes', () => {
    expect(decideTpeOutcome('timeout', 'quick')).toEqual({ finalizesSale: false, mode: null });
    expect(decideTpeOutcome('timeout', 'split')).toEqual({ finalizesSale: false, mode: null });
  });

  it('SUCCESS with no live context does NOT finalize (defensive — no stale finalize)', () => {
    expect(decideTpeOutcome('success', null)).toEqual({ finalizesSale: false, mode: null });
    expect(decideTpeOutcome('success', undefined)).toEqual({ finalizesSale: false, mode: null });
  });

  it('the success branch is REACHABLE — a success result yields a finalizing outcome', () => {
    // Guards M601: prior to the fix nothing produced finalizesSale:true via the UI;
    // this pins that a confirmed success is the path that finalizes a card sale.
    const out = decideTpeOutcome('success', 'quick');
    expect(out.finalizesSale).toBe(true);
    expect(out.mode).toBe('quick');
  });
});
