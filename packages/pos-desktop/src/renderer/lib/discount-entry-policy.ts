/**
 * POS-054 — pure client-side mirror of the SERVER discount policy
 * (packages/backend/src/modules/sales/discount-policy.ts). Extracted from
 * DiscountModal (P303, bloc D3) so the rules are unit-testable and stay
 * ALIGNED with the server:
 *   - hard cap 30% (POS channel, never bypassable),
 *   - responsable PIN required for ANY manual discount > 0%   ← server rule
 *     (the modal previously asked for it only above 20%: a 10% discount
 *      sailed through the modal and was then refused at payment — fixed),
 *   - written motive mandatory from 21% (JUSTIFICATION_REQUIRED_FROM_PCT).
 * The SERVER remains authoritative and re-verifies everything.
 */

export const HARD_CAP_PCT = 30;
export const JUSTIFICATION_REQUIRED_FROM_PCT = 21;
export const MIN_MOTIVE_LENGTH = 3;
export const MIN_PIN_LENGTH = 4;

/** Parse the operator input (comma tolerated) into centimes. */
export function computeDiscountAmount(
  mode: 'amount' | 'pct',
  rawValue: string,
  subtotalMinorUnits: number,
): number {
  const v = parseFloat((rawValue || '').replace(',', '.'));
  if (!Number.isFinite(v) || v <= 0) return 0;
  if (mode === 'pct') return Math.round((subtotalMinorUnits * Math.min(v, 100)) / 100);
  return Math.round(v * 100);
}

export interface DiscountEntryState {
  pct: number;
  overCap: boolean;
  exceedsSubtotal: boolean;
  needsPin: boolean;
  needsMotive: boolean;
  motiveOk: boolean;
  pinOk: boolean;
  canApply: boolean;
}

export function evaluateDiscountEntry(input: {
  amountMinorUnits: number;
  subtotalMinorUnits: number;
  reason: string;
  pin: string;
}): DiscountEntryState {
  const { amountMinorUnits, subtotalMinorUnits, reason, pin } = input;
  const pct = subtotalMinorUnits > 0 ? (amountMinorUnits / subtotalMinorUnits) * 100 : 0;
  const overCap = pct > HARD_CAP_PCT + 1e-9;
  const exceedsSubtotal = amountMinorUnits > subtotalMinorUnits;
  const needsPin = amountMinorUnits > 0; // server: RESPONSABLE_REQUIRED for any manual discount
  const needsMotive = pct >= JUSTIFICATION_REQUIRED_FROM_PCT; // server: from 21%
  const motiveOk = !needsMotive || reason.trim().length >= MIN_MOTIVE_LENGTH;
  const pinOk = !needsPin || pin.trim().length >= MIN_PIN_LENGTH;
  return {
    pct,
    overCap,
    exceedsSubtotal,
    needsPin,
    needsMotive,
    motiveOk,
    pinOk,
    canApply: amountMinorUnits > 0 && !exceedsSubtotal && !overCap && motiveOk && pinOk,
  };
}
