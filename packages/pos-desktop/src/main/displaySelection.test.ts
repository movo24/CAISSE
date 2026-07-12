import { describe, it, expect } from 'vitest';
import {
  selectClientDisplay,
  decideClientPlacement,
  boundsOverlap,
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

// ── Field bug (dual-screen Windows): client window must NEVER cover the register ──

describe('boundsOverlap', () => {
  it('detects overlapping and disjoint rectangles', () => {
    const prim = { x: 0, y: 0, width: 1920, height: 1080 };
    expect(boundsOverlap({ x: 100, y: 100, width: 50, height: 50 }, prim)).toBe(true); // inside
    expect(boundsOverlap({ x: 1900, y: 0, width: 1080, height: 1920 }, prim)).toBe(true); // 20px overlap
    expect(boundsOverlap({ x: 1920, y: 0, width: 1080, height: 1920 }, prim)).toBe(false); // edge-adjacent right
    expect(boundsOverlap({ x: -1080, y: 0, width: 1080, height: 1920 }, prim)).toBe(false); // edge-adjacent left
  });
});

describe('decideClientPlacement — secondary display ONLY (hard rule)', () => {
  const none = { screenId: null, signature: null };

  it('SINGLE SCREEN — refuses to show and logs "secondary display unavailable"', () => {
    const d = decideClientPlacement([PRIMARY], 1, none);
    expect(d.show).toBe(false);
    if (!d.show) {
      expect(d.reason).toBe('secondary-unavailable');
      expect(d.log).toContain('secondary display unavailable');
    }
  });

  it('NO DISPLAY — refuses to show (never throws)', () => {
    const d = decideClientPlacement([], 1, none);
    expect(d.show).toBe(false);
    if (!d.show) expect(d.reason).toBe('no-display');
  });

  it('TWO SCREENS — shows on the secondary with its exact bounds (never hard-coded)', () => {
    const d = decideClientPlacement([PRIMARY, VERTICAL], 1, none);
    expect(d.show).toBe(true);
    if (d.show) {
      expect(d.display.id).toBe(2);
      expect(d.bounds).toEqual({ x: 1920, y: 0, width: 1080, height: 1920 });
    }
  });

  it('SECONDARY ON THE LEFT (negative x) — exact bounds preserved', () => {
    const left = mk(3, 1080, 1920, -1080, 0);
    const d = decideClientPlacement([PRIMARY, left], 1, none);
    expect(d.show).toBe(true);
    if (d.show) expect(d.bounds).toEqual({ x: -1080, y: 0, width: 1080, height: 1920 });
  });

  it('SECONDARY ON THE RIGHT — exact bounds preserved', () => {
    const right = mk(4, 1080, 1920, 1920, 0);
    const d = decideClientPlacement([PRIMARY, right], 1, none);
    expect(d.show).toBe(true);
    if (d.show) expect(d.bounds).toEqual({ x: 1920, y: 0, width: 1080, height: 1920 });
  });

  it('HOT-UNPLUG — a re-decision after the secondary disappears refuses to show', () => {
    const persisted = { screenId: 2, signature: displaySignature(VERTICAL) };
    const before = decideClientPlacement([PRIMARY, VERTICAL], 1, persisted);
    expect(before.show).toBe(true);
    const after = decideClientPlacement([PRIMARY], 1, persisted); // secondary unplugged
    expect(after.show).toBe(false);
    if (!after.show) expect(after.log).toContain('secondary display unavailable');
  });

  it('HOT-REPLUG — the secondary coming back (even with a new Windows id) is re-used', () => {
    const persisted = { screenId: 2, signature: displaySignature(VERTICAL) };
    const unplugged = decideClientPlacement([PRIMARY], 1, persisted);
    expect(unplugged.show).toBe(false);
    // Windows renumbered the display after re-plug: id 2 → 7, same geometry.
    const replugged = decideClientPlacement([PRIMARY, { ...VERTICAL, id: 7 }], 1, persisted);
    expect(replugged.show).toBe(true);
    if (replugged.show) {
      expect(replugged.display.id).toBe(7);
      expect(replugged.reason).toBe('signature-match');
      expect(replugged.bounds).toEqual(VERTICAL.bounds);
    }
  });

  it('EXPLICIT PRIMARY CHOICE — a persisted id pointing at the primary is still refused', () => {
    const d = decideClientPlacement([PRIMARY, VERTICAL], 1, { screenId: 1, signature: null });
    expect(d.show).toBe(false);
    if (!d.show) expect(d.reason).toBe('secondary-unavailable');
  });

  it('FINAL GUARD — a secondary whose bounds overlap the primary is refused', () => {
    const overlapping = mk(5, 1080, 1920, 1900, 0); // 20px over the primary
    const d = decideClientPlacement([PRIMARY, overlapping], 1, none);
    expect(d.show).toBe(false);
    if (!d.show) expect(d.reason).toBe('overlaps-primary');
  });
});
