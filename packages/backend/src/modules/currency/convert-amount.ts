/**
 * POS — Currency conversion math (pure, unit-testable).
 * Extracted from CurrencyService.convert (behavior-preserving):
 *   minor(from) → major(from) → × rate → minor(to), rounded to nearest minor unit.
 */
export function convertMinor(
  amountMinorUnits: number,
  rate: number,
  fromPrecision: number,
  toPrecision: number,
): number {
  const majorFrom = amountMinorUnits / Math.pow(10, fromPrecision);
  const majorTo = majorFrom * rate;
  return Math.round(majorTo * Math.pow(10, toPrecision));
}
