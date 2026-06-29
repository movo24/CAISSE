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

export interface TaxRateBucket {
  rate: number; // VAT rate %
  grossMinorUnits: number; // TTC
  taxMinorUnits: number; // VAT
  baseMinorUnits: number; // HT (gross - tax)
}

/**
 * VAT broken down per rate (for multi-rate accounting: one 44571 line per rate).
 * Per-line rounding matches `sumLineTax`, so Σ taxMinorUnits === sumLineTax(lines).
 * Sorted by rate ascending; deterministic.
 */
export function taxBreakdownByRate(
  lines: { lineTotalMinorUnits: number; taxRate: number }[],
): TaxRateBucket[] {
  const byRate = new Map<number, TaxRateBucket>();
  for (const l of lines) {
    const rate = Number(l.taxRate);
    const tax = extractLineTax(l.lineTotalMinorUnits, rate);
    const b = byRate.get(rate) ?? { rate, grossMinorUnits: 0, taxMinorUnits: 0, baseMinorUnits: 0 };
    b.grossMinorUnits += l.lineTotalMinorUnits;
    b.taxMinorUnits += tax;
    b.baseMinorUnits = b.grossMinorUnits - b.taxMinorUnits;
    byRate.set(rate, b);
  }
  return [...byRate.values()].sort((a, b) => a.rate - b.rate);
}
