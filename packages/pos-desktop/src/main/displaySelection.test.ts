import { describe, it, expect } from 'vitest';
import {
  selectClientDisplay,
  displaySignature,
  signatureMatches,
  selectionStatus,
  type DisplayLike,
} from './displaySelection';

const mk = (id: number, w: number, h: number, x = 0, y = 0, rotation = 0): DisplayLike => ({
  id,
  bounds: { x, y, width: w, height: h },
  size: { width: w, height: h },
  scaleFactor: 1,
  rotation,
});

const PRIMARY = mk(1, 1920, 1080, 0, 0);
const VERTICAL = mk(2, 1080, 1920, 1920, 0);

describe('displaySignature / signatureMatches', () => {
  it('builds a signature from resolution + bounds + rotation', () => {
    expect(displaySignature(VERTICAL)).toEqual({ id: 2, resolution: '1080x1920', boundsX: 1920, boundsY: 0, rotation: 0 });
  });
  it('matches the same physical screen ignoring id', () => {
    const sig = displaySignature(VERTICAL);
    const relabelled = { ...VERTICAL, id: 99 };
    expect(signatureMatches(displaySignature(relabelled), sig)).toBe(true);
  });
  it('does not match a different resolution or position', () => {
    const sig = displaySignature(VERTICAL);
    expect(signatureMatches(displaySignature(mk(2, 720, 1280, 1920, 0)), sig)).toBe(false);
    expect(signatureMatches(displaySignature(mk(2, 1080, 1920, 0, 0)), sig)).toBe(false);
  });
});

describe('selectClientDisplay', () => {
  it('returns none when there are no displays', () => {
    const r = selectClientDisplay([], 1, { screenId: null, signature: null });
    expect(r.reason).toBe('none');
    expect(r.display).toBeNull();
  });

  it('honours a persisted id that still exists', () => {
    const r = selectClientDisplay([PRIMARY, VERTICAL], 1, { screenId: 2, signature: null });
    expect(r.reason).toBe('selected-id');
    expect(r.display?.id).toBe(2);
    expect(r.onPrimary).toBe(false);
  });

  it('recovers the screen by signature when Windows changed the id after reboot', () => {
    const relabelled = { ...VERTICAL, id: 77 };
    const r = selectClientDisplay([PRIMARY, relabelled], 1, {
      screenId: 2, // old id, no longer present
      signature: displaySignature(VERTICAL),
    });
    expect(r.reason).toBe('signature-match');
    expect(r.display?.id).toBe(77);
    expect(r.requestedScreenMissing).toBe(false);
  });

  it('prefers a non-primary screen for a signature match', () => {
    // Two screens share the signature; the non-primary must win.
    const a = mk(1, 1080, 1920, 1920, 0); // primary but vertical
    const b = mk(2, 1080, 1920, 1920, 0); // secondary same signature
    const r = selectClientDisplay([a, b], 1, { screenId: null, signature: displaySignature(a) });
    expect(r.reason).toBe('signature-match');
    expect(r.display?.id).toBe(2);
  });

  it('falls back to the best non-primary screen when the selected screen is gone', () => {
    const r = selectClientDisplay([PRIMARY, VERTICAL], 1, {
      screenId: 999,
      signature: { id: 999, resolution: '800x600', boundsX: -5000, boundsY: 0, rotation: 0 },
    });
    expect(r.reason).toBe('fallback-nonprimary');
    expect(r.display?.id).toBe(2);
    expect(r.requestedScreenMissing).toBe(true);
  });

  it('falls back to primary on a single-monitor machine', () => {
    const r = selectClientDisplay([PRIMARY], 1, { screenId: 2, signature: null });
    expect(r.reason).toBe('fallback-primary');
    expect(r.display?.id).toBe(1);
    expect(r.onPrimary).toBe(true);
    expect(r.requestedScreenMissing).toBe(true);
  });

  it('auto-picks the secondary screen on first run (no persisted choice)', () => {
    const r = selectClientDisplay([PRIMARY, VERTICAL], 1, { screenId: null, signature: null });
    expect(r.reason).toBe('fallback-nonprimary');
    expect(r.display?.id).toBe(2);
    expect(r.requestedScreenMissing).toBe(false); // nothing was requested
  });
});

describe('selectionStatus', () => {
  it('maps reasons to dashboard status', () => {
    expect(selectionStatus({ display: null, reason: 'none', requestedScreenMissing: false, onPrimary: false })).toBe('absent');
    expect(selectionStatus({ display: PRIMARY, reason: 'selected-id', requestedScreenMissing: false, onPrimary: false })).toBe('connected');
    expect(selectionStatus({ display: PRIMARY, reason: 'signature-match', requestedScreenMissing: false, onPrimary: false })).toBe('connected');
    expect(selectionStatus({ display: PRIMARY, reason: 'fallback-nonprimary', requestedScreenMissing: true, onPrimary: false })).toBe('wrong-screen');
    expect(selectionStatus({ display: PRIMARY, reason: 'fallback-nonprimary', requestedScreenMissing: false, onPrimary: false })).toBe('fallback');
  });
});
