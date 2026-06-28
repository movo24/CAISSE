/**
 * POS — Ticket number formatting (pure, unit-testable).
 * Extracted from createSale (behavior-preserving): `T-` + 6-digit zero-padded sequence.
 * Padding is display-only; ordering/chain rely on the integer cursor (sale_seq).
 */
export function formatTicketNumber(saleSeq: number): string {
  return `T-${String(saleSeq).padStart(6, '0')}`;
}
