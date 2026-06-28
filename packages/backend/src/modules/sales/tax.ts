/**
 * POS-063 — VAT (TVA) extraction from TTC (gross) line totals.
 *
 * IMPORTANT: this matches the EXACT formula used in SalesService.createSale and bound
 * into the fiscal hash (`taxTotalMinorUnits`). It is intentionally NOT replaced by
 * `shared/utils/money.ts#extractTax` (net-first rounding), which can differ by 1 cent in
 * half-cases — changing it would alter the fiscal hash. The reconciliation of the two
 * formulas is a documented decision (TECHNICAL_DEBT TD-TAX-DUP), not done here.
 *
 * All amounts are integer minor units (centimes).
 */

/** VAT component of a TTC amount: round(gross * rate / (100 + rate)). */
export function extractLineTax(
  grossMinorUnits: number,
  taxRatePercent: number,
): number {
  if (grossMinorUnits <= 0 || taxRatePercent <= 0) return 0;
  return Math.round(grossMinorUnits * (taxRatePercent / (100 + taxRatePercent)));
}

/** Sum the VAT across line items (gross line totals), per-line rounding (matches createSale). */
export function sumLineTax(
  lines: { lineTotalMinorUnits: number; taxRate: number }[],
): number {
  return lines.reduce(
    (sum, l) => sum + extractLineTax(l.lineTotalMinorUnits, l.taxRate),
    0,
  );
}
