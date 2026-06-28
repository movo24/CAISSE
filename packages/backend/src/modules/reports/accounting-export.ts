/**
 * POS-100 — Accounting export (pure, unit-testable). LOCAL export only.
 *
 * Builds a daily accounting summary (TTC/HT/TVA, tenders, discount) from already-aggregated
 * Z-report figures, and serializes to a French-style CSV (";" separator, amounts in major units).
 *
 * NOTE: this is the LOCAL export foundation. Sending to Comptamax24 is NOT implemented
 * (external integration, non branché — see POS_INTEGRATIONS / TD-COMPTAMAX).
 */

export interface AccountingExportInput {
  date: string;
  storeId: string;
  totalRevenueMinorUnits: number; // TTC
  totalTaxMinorUnits: number;
  cashTotalMinorUnits: number;
  cardTotalMinorUnits: number;
  discountTotalMinorUnits: number;
  transactionCount: number;
}

export interface AccountingExportRow {
  date: string;
  storeId: string;
  totalTtcMinorUnits: number;
  totalHtMinorUnits: number;
  totalTvaMinorUnits: number;
  cashMinorUnits: number;
  cardMinorUnits: number;
  otherTendersMinorUnits: number;
  discountMinorUnits: number;
  transactionCount: number;
}

export function buildDailyAccountingExport(
  input: AccountingExportInput,
): AccountingExportRow {
  const ttc = input.totalRevenueMinorUnits;
  const tva = input.totalTaxMinorUnits;
  // Other tenders = anything not cash/card (mobile, check, voucher, store_credit). Never negative.
  const other = Math.max(0, ttc - input.cashTotalMinorUnits - input.cardTotalMinorUnits);
  return {
    date: input.date,
    storeId: input.storeId,
    totalTtcMinorUnits: ttc,
    totalHtMinorUnits: ttc - tva,
    totalTvaMinorUnits: tva,
    cashMinorUnits: input.cashTotalMinorUnits,
    cardMinorUnits: input.cardTotalMinorUnits,
    otherTendersMinorUnits: other,
    discountMinorUnits: input.discountTotalMinorUnits,
    transactionCount: input.transactionCount,
  };
}

const CSV_HEADERS = [
  'date',
  'store_id',
  'total_ttc',
  'total_ht',
  'total_tva',
  'cash',
  'card',
  'autres',
  'remise',
  'nb_tickets',
];

/** Format minor units → major (e.g. 1234 → "12.34"). */
function major(minor: number): string {
  return (minor / 100).toFixed(2);
}

/** Serialize rows to a ";"-separated CSV (French convention). Amounts in major units. */
export function toAccountingCsv(rows: AccountingExportRow[]): string {
  const lines = [CSV_HEADERS.join(';')];
  for (const r of rows) {
    lines.push(
      [
        r.date,
        r.storeId,
        major(r.totalTtcMinorUnits),
        major(r.totalHtMinorUnits),
        major(r.totalTvaMinorUnits),
        major(r.cashMinorUnits),
        major(r.cardMinorUnits),
        major(r.otherTendersMinorUnits),
        major(r.discountMinorUnits),
        String(r.transactionCount),
      ].join(';'),
    );
  }
  return lines.join('\n');
}
