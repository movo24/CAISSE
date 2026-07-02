import { describe, it, expect } from 'vitest';
import {
  computeDiscountAmount,
  evaluateDiscountEntry,
  HARD_CAP_PCT,
  JUSTIFICATION_REQUIRED_FROM_PCT,
} from './discount-entry-policy';

// P303 (bloc D3) — client mirror of the server discount policy, ALIGNED:
// PIN for any discount > 0 (server RESPONSABLE_REQUIRED), motive from 21%,
// hard cap 30% never applicable client-side either.

const SUBTOTAL = 10_000; // 100.00 €

const entry = (amountMinorUnits: number, reason = '', pin = '') =>
  evaluateDiscountEntry({ amountMinorUnits, subtotalMinorUnits: SUBTOTAL, reason, pin });

describe('computeDiscountAmount', () => {
  it('parses amounts with comma or dot into centimes', () => {
    expect(computeDiscountAmount('amount', '5,50', SUBTOTAL)).toBe(550);
    expect(computeDiscountAmount('amount', '5.50', SUBTOTAL)).toBe(550);
  });
  it('pct mode converts against the subtotal and caps input at 100', () => {
    expect(computeDiscountAmount('pct', '10', SUBTOTAL)).toBe(1000);
    expect(computeDiscountAmount('pct', '250', SUBTOTAL)).toBe(SUBTOTAL);
  });
  it('garbage, empty and non-positive input → 0', () => {
    expect(computeDiscountAmount('amount', '', SUBTOTAL)).toBe(0);
    expect(computeDiscountAmount('amount', 'abc', SUBTOTAL)).toBe(0);
    expect(computeDiscountAmount('pct', '-5', SUBTOTAL)).toBe(0);
  });
});

describe('evaluateDiscountEntry — alignment with the SERVER policy', () => {
  it('ANY discount > 0 requires the responsable PIN (server: RESPONSABLE_REQUIRED) — even 10%', () => {
    const tenPct = entry(1000); // 10%, no pin
    expect(tenPct.needsPin).toBe(true);
    expect(tenPct.canApply).toBe(false);
    expect(entry(1000, '', '1234').canApply).toBe(true); // pin provided → ok, no motive needed below 21%
  });

  it('motive becomes mandatory from 21% (JUSTIFICATION_REQUIRED_FROM_PCT), not before', () => {
    expect(JUSTIFICATION_REQUIRED_FROM_PCT).toBe(21);
    expect(entry(2000, '', '1234').canApply).toBe(true); // 20% : pin suffit
    const at21 = entry(2100, '', '1234'); // 21% sans motif
    expect(at21.needsMotive).toBe(true);
    expect(at21.canApply).toBe(false);
    expect(entry(2100, 'client fidèle mécontent', '1234').canApply).toBe(true);
    expect(entry(2100, 'ab', '1234').canApply).toBe(false); // motive too short
  });

  it('hard cap: 30.00% exact passes, anything above is refused regardless of PIN/motive', () => {
    expect(HARD_CAP_PCT).toBe(30);
    expect(entry(3000, 'motif valable', '1234').canApply).toBe(true); // exactly 30%
    const over = entry(3001, 'motif valable', '1234'); // 30.01%
    expect(over.overCap).toBe(true);
    expect(over.canApply).toBe(false);
  });

  it('a discount larger than the subtotal is refused; zero amount cannot be applied', () => {
    expect(entry(SUBTOTAL + 1, 'motif', '1234').exceedsSubtotal).toBe(true);
    expect(entry(SUBTOTAL + 1, 'motif', '1234').canApply).toBe(false);
    expect(entry(0).canApply).toBe(false);
  });

  it('short PIN (<4) is not accepted', () => {
    expect(entry(1000, '', '123').canApply).toBe(false);
  });
});
