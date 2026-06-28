/**
 * POS-017 — Cash counting & reconciliation (pure, no DB/Nest → unit-testable).
 *
 * Used for the midday and closing cash counts. The persistence (session fields +
 * migration) and the "cash sales of the session" query are a separate wiring block
 * (POS-017b) — this module is the reconciliation MATH only, fully verifiable in isolation.
 *
 * All amounts are integer minor units (centimes). Never floats.
 */

export interface DenominationCount {
  /** Face value in minor units (e.g. 500 = 5€ note, 100 = 1€ coin). */
  valueMinorUnits: number;
  /** How many of this denomination were counted (>= 0). */
  count: number;
}

export type CashReconcileStatus = 'balanced' | 'over' | 'short';

export interface CashReconcileInput {
  openingFloatMinorUnits: number;
  cashSalesMinorUnits: number;
  cashRefundsMinorUnits: number;
  /** Physically counted cash in the drawer. */
  countedMinorUnits: number;
  /** Acceptable absolute variance (default 0 = exact). */
  toleranceMinorUnits?: number;
}

export interface CashReconcileResult {
  expectedMinorUnits: number;
  varianceMinorUnits: number; // counted - expected (>0 over, <0 short)
  status: CashReconcileStatus;
  withinTolerance: boolean;
}

/** Sum a denomination breakdown into a total. Rejects negative counts/values. */
export function countCash(denominations: DenominationCount[]): number {
  let total = 0;
  for (const d of denominations) {
    if (!Number.isInteger(d.valueMinorUnits) || d.valueMinorUnits < 0) {
      throw new Error(`Valeur de coupure invalide: ${d.valueMinorUnits}`);
    }
    if (!Number.isInteger(d.count) || d.count < 0) {
      throw new Error(`Nombre de coupures invalide: ${d.count}`);
    }
    total += d.valueMinorUnits * d.count;
  }
  return total;
}

/**
 * Reconcile counted cash against the expected drawer amount.
 * expected = openingFloat + cashSales - cashRefunds
 * variance = counted - expected
 */
export function reconcileCash(input: CashReconcileInput): CashReconcileResult {
  const tolerance = Math.max(0, input.toleranceMinorUnits ?? 0);
  const expected =
    input.openingFloatMinorUnits +
    input.cashSalesMinorUnits -
    input.cashRefundsMinorUnits;
  const variance = input.countedMinorUnits - expected;
  const withinTolerance = Math.abs(variance) <= tolerance;
  let status: CashReconcileStatus;
  if (variance === 0 || withinTolerance) status = 'balanced';
  else if (variance > 0) status = 'over';
  else status = 'short';
  return { expectedMinorUnits: expected, varianceMinorUnits: variance, status, withinTolerance };
}
