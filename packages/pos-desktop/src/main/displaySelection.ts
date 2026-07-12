/**
 * Customer Display — pure display-selection & signature logic (unit-testable).
 *
 * Windows can reassign Electron display ids across reboots or hot-plug, so we
 * can't rely on the persisted id alone. This module picks the client display
 * from a plain list (no `electron` import → testable under vitest) using:
 *   1. the persisted id, if it still exists;
 *   2. else a persisted *signature* (resolution + bounds + rotation) match —
 *      this recovers the same physical screen when only the id changed;
 *   3. else the best non-primary screen;
 *   4. else the primary screen (single-monitor fallback).
 *
 * It never throws and always reports WHY a screen was chosen, so the dashboard
 * can show connected / absent / wrong-screen / fallback.
 */

export interface DisplayLike {
  id: number;
  bounds: { x: number; y: number; width: number; height: number };
  size: { width: number; height: number };
  scaleFactor: number;
  rotation?: number;
  internal?: boolean;
}

export interface DisplaySignature {
  id: number | null;
  resolution: string; // "1920x1080"
  boundsX: number;
  boundsY: number;
  rotation: number;
}

export type SelectionReason =
  | 'selected-id' // persisted id still present
  | 'signature-match' // id changed but the physical screen matched by signature
  | 'fallback-nonprimary' // no match → best secondary screen
  | 'fallback-primary' // only one screen → primary
  | 'none'; // no displays at all

export interface SelectionResult {
  display: DisplayLike | null;
  reason: SelectionReason;
  /** True when the operator had picked a screen that is no longer present. */
  requestedScreenMissing: boolean;
  /** True when the chosen screen is the primary (operator) screen. */
  onPrimary: boolean;
}

export function displaySignature(d: DisplayLike): DisplaySignature {
  return {
    id: d.id,
    resolution: `${d.size.width}x${d.size.height}`,
    boundsX: d.bounds.x,
    boundsY: d.bounds.y,
    rotation: d.rotation ?? 0,
  };
}

/** Two signatures describe the same physical screen (ignoring id). */
export function signatureMatches(a: DisplaySignature, b: DisplaySignature): boolean {
  return a.resolution === b.resolution && a.boundsX === b.boundsX && a.boundsY === b.boundsY;
}

export interface PersistedSelection {
  screenId: number | null;
  signature: DisplaySignature | null;
}

export function selectClientDisplay(
  displays: DisplayLike[],
  primaryId: number,
  persisted: PersistedSelection,
): SelectionResult {
  if (!displays || displays.length === 0) {
    return { display: null, reason: 'none', requestedScreenMissing: false, onPrimary: false };
  }

  const hadRequest = persisted.screenId != null || persisted.signature != null;

  // 1) Persisted id still present → honour the explicit choice.
  if (persisted.screenId != null) {
    const byId = displays.find((d) => d.id === persisted.screenId);
    if (byId) {
      return { display: byId, reason: 'selected-id', requestedScreenMissing: false, onPrimary: byId.id === primaryId };
    }
  }

  // 2) Signature match (id changed after reboot / re-plug). Prefer non-primary.
  if (persisted.signature) {
    const matches = displays.filter((d) => signatureMatches(displaySignature(d), persisted.signature!));
    const pick = matches.find((d) => d.id !== primaryId) || matches[0];
    if (pick) {
      return { display: pick, reason: 'signature-match', requestedScreenMissing: false, onPrimary: pick.id === primaryId };
    }
  }

  // 3) Best non-primary screen.
  const secondary = displays.find((d) => d.id !== primaryId);
  if (secondary) {
    return { display: secondary, reason: 'fallback-nonprimary', requestedScreenMissing: hadRequest, onPrimary: false };
  }

  // 4) Single monitor → primary.
  const primary = displays.find((d) => d.id === primaryId) || displays[0];
  return { display: primary, reason: 'fallback-primary', requestedScreenMissing: hadRequest, onPrimary: true };
}

/** Human status for the dashboard, derived from a selection result. */
export function selectionStatus(result: SelectionResult): 'connected' | 'absent' | 'wrong-screen' | 'fallback' {
  if (!result.display) return 'absent';
  if (result.reason === 'selected-id') return 'connected';
  if (result.reason === 'signature-match') return 'connected';
  if (result.requestedScreenMissing) return 'wrong-screen';
  return 'fallback';
}

// ── Hard placement rule: the client window opens on a SECONDARY display ONLY ──
//
// Field bug (Windows mini-PC): on a single-screen register (or before Windows
// extends the desktop), the old `fallback-primary` path opened the client window
// ON TOP of the register window and the watchdog kept re-spawning it after every
// manual close. The placement decision below is the single source of truth used
// by the controller: no secondary display detected → the client window is NOT
// shown, ever. Pure and DB/Electron-free so every scenario is unit-testable.

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** True when two rectangles overlap by at least one pixel. */
export function boundsOverlap(a: Rect, b: Rect): boolean {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  );
}

export type PlacementDecision =
  | {
      show: false;
      /** Greppable field-diagnostic message. */
      log: string;
      reason: 'no-display' | 'secondary-unavailable' | 'overlaps-primary';
      selection: SelectionResult;
    }
  | {
      show: true;
      display: DisplayLike;
      /** Exact bounds of the secondary display — never hard-coded coordinates. */
      bounds: Rect;
      reason: SelectionReason;
      selection: SelectionResult;
    };

/**
 * Decide where (and whether) the client window may open.
 *
 * 1. No display at all → don't show.
 * 2. Resolved target is the primary (operator) screen — single monitor,
 *    or an explicit/persisted choice pointing at the primary → don't show:
 *    the register screen must never be covered.
 * 3. Final guard: even a non-primary target whose bounds overlap the primary
 *    display (exotic mirrored/overlapping virtual desktop) → don't show.
 * 4. Otherwise → show at the exact bounds of the secondary display.
 */
export function decideClientPlacement(
  displays: DisplayLike[],
  primaryId: number,
  persisted: PersistedSelection,
): PlacementDecision {
  const selection = selectClientDisplay(displays, primaryId, persisted);

  if (!selection.display) {
    return { show: false, log: 'secondary display unavailable (no display detected)', reason: 'no-display', selection };
  }
  if (selection.onPrimary) {
    return {
      show: false,
      log: `secondary display unavailable (only primary display ${primaryId} present or targeted)`,
      reason: 'secondary-unavailable',
      selection,
    };
  }
  const primary = displays.find((d) => d.id === primaryId);
  if (primary && boundsOverlap(selection.display.bounds, primary.bounds)) {
    return {
      show: false,
      log: `client window bounds ${JSON.stringify(selection.display.bounds)} overlap primary display ${primaryId} — refusing to show`,
      reason: 'overlaps-primary',
      selection,
    };
  }
  return {
    show: true,
    display: selection.display,
    bounds: { ...selection.display.bounds },
    reason: selection.reason,
    selection,
  };
}
