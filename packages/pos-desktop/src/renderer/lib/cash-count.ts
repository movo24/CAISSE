/**
 * P322 (cycle I5) — pure till-count math for the session close screen (POS-017b).
 * Consumes GET /pos-sessions/:id/cash-summary; the operator types the counted
 * cash; we compute the écart. Ready-to-wire (no session UI exists yet).
 */

export interface CashSummary {
  sessionId: string;
  salesCount: number;
  cashCapturedMinorUnits: number;
  totalCapturedMinorUnits: number;
}

export interface CashCountResult {
  expectedMinorUnits: number; // fond de caisse + espèces encaissées
  countedMinorUnits: number;
  deltaMinorUnits: number; // compté − attendu (négatif = manquant)
  status: 'exact' | 'excédent' | 'manquant';
}

export function computeCashCount(
  summary: CashSummary,
  openingFloatMinorUnits: number,
  countedMinorUnits: number,
): CashCountResult {
  const expected = Math.max(0, openingFloatMinorUnits) + summary.cashCapturedMinorUnits;
  const delta = countedMinorUnits - expected;
  return {
    expectedMinorUnits: expected,
    countedMinorUnits,
    deltaMinorUnits: delta,
    status: delta === 0 ? 'exact' : delta > 0 ? 'excédent' : 'manquant',
  };
}

/** Parse operator cash input in euros ("152,50") → centimes; garbage → null (refuse, don't guess). */
export function parseCountedEuros(raw: string): number | null {
  const v = parseFloat((raw || '').replace(',', '.'));
  if (!Number.isFinite(v) || v < 0) return null;
  return Math.round(v * 100);
}
