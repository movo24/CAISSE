/**
 * POS — Currency conversion math (pure, unit-testable).
 *
 * POS-INT-137 — float-precision fix: the previous form divided the integer minor
 * amount by 10^fromPrecision FIRST, then multiplied by the rate. That leading
 * division injected binary-float error so a true `.5` boundary (e.g. 107135×1.1 =
 * 117848.5) rounded DOWN to 117848 instead of 117849 (off-by-one centime, 34/87594
 * sampled). Multiplying the integer amount by the rate FIRST, applying the
 * precision scale in a single factor, removes those boundary errors.
 */
export function convertMinor(
  amountMinorUnits: number,
  rate: number,
  fromPrecision: number,
  toPrecision: number,
): number {
  const scale = Math.pow(10, toPrecision - fromPrecision);
  return Math.round(amountMinorUnits * rate * scale);
}
