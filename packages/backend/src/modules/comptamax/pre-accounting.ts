/**
 * POS → Comptamax24 — pre-accounting engine (pure, unit-testable).
 *
 * Maps POS fiscal events (sales, refunds, credit notes) to balanced double-entry
 * journal lines (débit/crédit) using a simplified French retail chart of accounts.
 * Amounts are integer centimes. No DB, no side effects — Comptamax24 (or a CSV
 * export) consumes the result; the caisse is never in the loop.
 *
 * Invariant: for every document, Σ débit === Σ crédit.
 */

/** Simplified PCG accounts (overridable later via config). */
export const ACCOUNTS = {
  VENTE_HT: '707000', // Ventes de marchandises (HT)
  TVA_COLLECTEE: '445710', // TVA collectée
  CAISSE_ESPECES: '531000', // Caisse (espèces)
  BANQUE_CARTE: '512000', // Banque (CB / Stripe)
  AVOIR_CLIENT: '419100', // Clients — avoirs / store credit
  ATTENTE: '471000', // Compte d'attente (moyen inconnu)
  RRR_ACCORDEES: '709000', // Remises, rabais, ristournes accordés
} as const;

export interface JournalLine {
  account: string;
  label: string;
  debitMinorUnits: number;
  creditMinorUnits: number;
}

/** Map a POS payment method to its encaissement account. */
export function paymentAccount(method: string): string {
  switch (method) {
    case 'cash':
      return ACCOUNTS.CAISSE_ESPECES;
    case 'card':
    case 'stripe_terminal':
      return ACCOUNTS.BANQUE_CARTE;
    case 'store_credit':
      return ACCOUNTS.AVOIR_CLIENT;
    default:
      return ACCOUNTS.ATTENTE;
  }
}

export interface SaleJournalInput {
  ticketNumber: string;
  totalMinorUnits: number; // TTC encaissé
  taxTotalMinorUnits: number;
  payments: { method: string; amountMinorUnits: number }[];
}

/**
 * Balanced journal for one sale:
 *  - crédit 707 = HT (TTC − TVA), crédit 44571 = TVA ;
 *  - débit encaissements par moyen de paiement (= TTC).
 */
export function buildSaleJournalLines(input: SaleJournalInput): JournalLine[] {
  const htMinorUnits = input.totalMinorUnits - input.taxTotalMinorUnits;
  const lines: JournalLine[] = [];

  for (const p of input.payments) {
    if (p.amountMinorUnits === 0) continue;
    lines.push({
      account: paymentAccount(p.method),
      label: `Encaissement ${p.method} ${input.ticketNumber}`,
      debitMinorUnits: p.amountMinorUnits,
      creditMinorUnits: 0,
    });
  }
  lines.push({
    account: ACCOUNTS.VENTE_HT,
    label: `Vente HT ${input.ticketNumber}`,
    debitMinorUnits: 0,
    creditMinorUnits: htMinorUnits,
  });
  if (input.taxTotalMinorUnits !== 0) {
    lines.push({
      account: ACCOUNTS.TVA_COLLECTEE,
      label: `TVA collectée ${input.ticketNumber}`,
      debitMinorUnits: 0,
      creditMinorUnits: input.taxTotalMinorUnits,
    });
  }
  return lines;
}

export interface RefundJournalInput {
  code: string;
  totalMinorUnits: number;
  taxTotalMinorUnits?: number; // optional; 0 when not split
  type: 'refund' | 'store_credit';
  refundMethod: string | null;
}

/**
 * Balanced journal for a refund / credit note (reverse of a sale):
 *  - débit 707 (HT) + débit 44571 (TVA) ;
 *  - crédit encaissement (cash/card) OR crédit 4191 (avoir émis).
 */
export function buildRefundJournalLines(input: RefundJournalInput): JournalLine[] {
  const tax = input.taxTotalMinorUnits ?? 0;
  const ht = input.totalMinorUnits - tax;
  const counterpart =
    input.type === 'store_credit'
      ? ACCOUNTS.AVOIR_CLIENT
      : paymentAccount(input.refundMethod ?? '');
  return [
    { account: ACCOUNTS.VENTE_HT, label: `Avoir HT ${input.code}`, debitMinorUnits: ht, creditMinorUnits: 0 },
    ...(tax !== 0
      ? [{ account: ACCOUNTS.TVA_COLLECTEE, label: `Avoir TVA ${input.code}`, debitMinorUnits: tax, creditMinorUnits: 0 }]
      : []),
    { account: counterpart, label: `Remboursement ${input.code}`, debitMinorUnits: 0, creditMinorUnits: input.totalMinorUnits },
  ];
}

/** Σ débit and Σ crédit (integer centimes). */
export function journalTotals(lines: JournalLine[]): { debit: number; credit: number } {
  return lines.reduce(
    (acc, l) => ({ debit: acc.debit + l.debitMinorUnits, credit: acc.credit + l.creditMinorUnits }),
    { debit: 0, credit: 0 },
  );
}

/** A journal is valid only when it balances. */
export function journalIsBalanced(lines: JournalLine[]): boolean {
  const { debit, credit } = journalTotals(lines);
  return debit === credit;
}

/** Aggregate many lines into one line per account (day-level pre-accounting journal). */
export function aggregateJournalByAccount(lines: JournalLine[]): JournalLine[] {
  const byAccount = new Map<string, JournalLine>();
  for (const l of lines) {
    const cur = byAccount.get(l.account);
    if (cur) {
      cur.debitMinorUnits += l.debitMinorUnits;
      cur.creditMinorUnits += l.creditMinorUnits;
    } else {
      byAccount.set(l.account, { account: l.account, label: l.label, debitMinorUnits: l.debitMinorUnits, creditMinorUnits: l.creditMinorUnits });
    }
  }
  return [...byAccount.values()].sort((a, b) => a.account.localeCompare(b.account));
}

/** CSV (compte;libellé;débit;crédit) — débit/crédit in major units, 2 decimals, comma. */
export function journalToCsv(lines: JournalLine[]): string {
  const fmt = (c: number) => (c / 100).toFixed(2).replace('.', ',');
  const header = 'compte;libelle;debit;credit';
  const rows = lines.map(
    (l) => `${l.account};${l.label};${fmt(l.debitMinorUnits)};${fmt(l.creditMinorUnits)}`,
  );
  return [header, ...rows].join('\n');
}
