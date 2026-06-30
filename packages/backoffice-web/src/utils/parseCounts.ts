/**
 * POS-FE-155 — parse a pasted physical count into { ean, countedQty } rows.
 * Tolerant of ; , tab or space separators; ignores blank/invalid lines.
 * Pure & unit-testable (extracted from InventoryVariancePage).
 */
export function parseCounts(raw: string): { ean: string; countedQty: number }[] {
  const out: { ean: string; countedQty: number }[] = [];
  for (const line of (raw || '').split(/\r?\n/)) {
    const t = line.trim();
    if (!t) continue;
    const parts = t.split(/[;,\t ]+/).filter(Boolean);
    if (parts.length < 2) continue;
    const ean = parts[0];
    const qty = parseInt(parts[parts.length - 1], 10);
    if (!ean || !Number.isFinite(qty)) continue;
    out.push({ ean, countedQty: qty });
  }
  return out;
}
