/**
 * Ventilation de TVA par taux à partir des lignes de vente.
 *
 * Règle fiscale : les montants stockés (TTC ligne, `tax_total_minor_units`)
 * sont FIGÉS — cette fonction ne recalcule jamais le total de la vente, elle
 * répartit l'affichage par taux avec EXACTEMENT la même formule d'extraction
 * que le moteur de vente (sales.service.ts : round(ttc × taux / (100 + taux))
 * par ligne, puis somme) : la somme des TVA affichées == tax_total stocké.
 */
export interface VatLine {
  lineTotalMinorUnits: number;
  taxRate: number | string; // colonne decimal → parfois string côté driver pg
}

export interface VatBreakdownRow {
  /** Taux en % (ex. 20, 5.5) */
  rate: number;
  /** Base HT en centimes (ttc − tva) */
  htMinorUnits: number;
  /** TVA en centimes */
  tvaMinorUnits: number;
  /** TTC en centimes */
  ttcMinorUnits: number;
}

export function computeVatBreakdown(lines: VatLine[]): VatBreakdownRow[] {
  const byRate = new Map<number, { ttc: number; tva: number }>();
  for (const line of lines) {
    const rate = typeof line.taxRate === 'string' ? parseFloat(line.taxRate) : line.taxRate;
    const safeRate = Number.isFinite(rate) ? rate : 0;
    const ttc = line.lineTotalMinorUnits;
    // Même formule que sales.service.ts (extraction TVA du TTC, par ligne).
    const tva = safeRate > 0 ? Math.round(ttc * (safeRate / (100 + safeRate))) : 0;
    const acc = byRate.get(safeRate) ?? { ttc: 0, tva: 0 };
    acc.ttc += ttc;
    acc.tva += tva;
    byRate.set(safeRate, acc);
  }
  return [...byRate.entries()]
    .map(([rate, { ttc, tva }]) => ({
      rate,
      ttcMinorUnits: ttc,
      tvaMinorUnits: tva,
      htMinorUnits: ttc - tva,
    }))
    .sort((a, b) => a.rate - b.rate);
}
