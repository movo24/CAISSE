/**
 * POS-INT-131 — sale total consistency guard (pure, unit-testable).
 *
 * NF525 defense-in-depth: the emitted ticket and the recorded sale total must
 * always agree with the sum of the (discounted) line nets. This holds by
 * construction in createSale (promo + cumulative manual-discount distribution),
 * but a future refactor could silently break it and emit an inconsistent ticket.
 * `assertSaleTotalsConsistent` fails closed (throws) rather than let an incoherent
 * sale through. Integer centimes; no DB, no Nest.
 */

export class SaleTotalInconsistency extends Error {
  constructor(public readonly sumLineNets: number, public readonly totalAfterDiscount: number) {
    super(
      `Sale total inconsistency: Σ line nets (${sumLineNets}) ≠ total after discount (${totalAfterDiscount})`,
    );
    this.name = 'SaleTotalInconsistency';
  }
}

/** Sum of per-line net totals (after promo + manual discount), in centimes. */
export function sumLineNets(lineNets: readonly number[]): number {
  return lineNets.reduce((a, b) => a + b, 0);
}

/**
 * Throw when the sum of discounted line nets does not equal the sale total.
 * Returns the verified total on success (for convenient inline use).
 */
export function assertSaleTotalsConsistent(
  lineNets: readonly number[],
  totalAfterDiscount: number,
): number {
  const sum = sumLineNets(lineNets);
  if (sum !== totalAfterDiscount) {
    throw new SaleTotalInconsistency(sum, totalAfterDiscount);
  }
  return totalAfterDiscount;
}
