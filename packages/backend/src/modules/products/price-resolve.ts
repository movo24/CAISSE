/**
 * POS-061 — Effective price resolution (pure, unit-testable).
 * Decision (2026-06-28): the store override price takes PRIORITY over the global price.
 * A null/undefined override (or a negative one, treated as unset) falls back to the global.
 */
export function resolveEffectivePrice(
  globalPriceMinorUnits: number,
  overrideMinorUnits: number | null | undefined,
): number {
  if (overrideMinorUnits != null && overrideMinorUnits >= 0) {
    return overrideMinorUnits;
  }
  return globalPriceMinorUnits;
}
