/**
 * P325 (cycle J) — stable physical-terminal identifier for the γ session model.
 *
 * UX choice (documented): each POS install gets ONE persistent terminal id,
 * generated on first use and kept in localStorage — matching the backend's
 * "physical terminal" semantics (sessions are bound to the DEVICE, not the
 * employee). Admins can override it via localStorage `pos-terminal-id` if a
 * store labels its tills (e.g. "CAISSE-1").
 */

export const TERMINAL_ID_KEY = 'pos-terminal-id';

export function getTerminalId(storage: Pick<Storage, 'getItem' | 'setItem'> = window.localStorage): string {
  const existing = (storage.getItem(TERMINAL_ID_KEY) || '').trim();
  if (existing) return existing;
  const generated = `TERM-${(globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2, 10)}`)}`;
  storage.setItem(TERMINAL_ID_KEY, generated);
  return generated;
}
