/**
 * PdfService — génération de documents PDF (duplicata ticket, justificatif
 * d'avoir, export Z-report).
 *
 * RÈGLE FISCALE STRICTE
 * ─────────────────────
 * Ce service est un *rendu*, jamais un *calcul*. Il consomme exclusivement des
 * données DÉJÀ FIGÉES (vente / avoir / Z déjà validés en base) et les imprime
 * verbatim. Il ne recalcule JAMAIS un sous-total, une remise, une TVA ou un
 * total — ces valeurs viennent telles quelles de l'appelant. Toute évolution
 * doit préserver cette propriété (couverte par pdf.service.spec.ts).
 *
 * Aucune dépendance native, aucun Chromium : pdf-lib (MIT) uniquement.
 */
import { Injectable } from '@nestjs/common';
import { PDFDocument, StandardFonts, rgb, PDFFont, PDFPage } from 'pdf-lib';

/* ── Entrées (données figées fournies par l'appelant) ───────────────────── */

export interface PdfMoney {
  /** Montant en unités mineures (centimes) — entier, tel que stocké en base. */
  minorUnits: number;
  /** Code devise ISO (ex. 'EUR'). */
  currencyCode: string;
}

export interface SaleLineInput {
  productName: string;
  quantity: number;
  unitPriceMinorUnits: number;
  lineTotalMinorUnits: number;
  taxRate?: number;
}

export interface SaleDuplicataInput {
  storeName: string;
  storeAddress?: string;
  siret?: string;
  tvaIntracom?: string;
  ticketNumber: string;
  createdAt: string | Date;
  employeeName?: string;
  currencyCode: string;
  lines: SaleLineInput[];
  /** Totaux FIGÉS — imprimés verbatim, jamais recalculés. */
  subtotalMinorUnits: number;
  discountTotalMinorUnits: number;
  taxTotalMinorUnits: number;
  totalMinorUnits: number;
  payments?: { method: string; amountMinorUnits: number }[];
  hashChainCurrent?: string;
  footerMessage?: string;
}

export interface CreditNoteJustificatifInput {
  storeName: string;
  number: string;
  origin: 'return' | 'gift_card';
  originalTicketNumber?: string | null;
  createdAt: string | Date;
  employeeName?: string;
  currencyCode: string;
  totalMinorUnits: number;
  remainingMinorUnits: number;
  refundMethod?: string | null;
  reason?: string | null;
  hashChainCurrent?: string | null;
}

export interface ZReportInput {
  storeName: string;
  date: string;
  transactionCount: number;
  currencyCode: string;
  totalRevenueMinorUnits: number;
  totalTaxMinorUnits: number;
  discountTotalMinorUnits: number;
  cashTotalMinorUnits: number;
  cardTotalMinorUnits: number;
  averageBasketMinorUnits?: number;
  hash?: string;
}

/** Une ligne « libellé : valeur » telle qu'elle sera imprimée. */
export interface SummaryRow {
  label: string;
  value: string;
}

/* ── Helpers purs (testables, sans I/O) ──────────────────────────────────── */

/** Formate des unités mineures en chaîne devise FR, SANS arrondi ni calcul. */
export function formatMoney(minorUnits: number, currencyCode = 'EUR'): string {
  const negative = minorUnits < 0;
  const abs = Math.abs(Math.trunc(minorUnits));
  const major = Math.floor(abs / 100);
  const cents = (abs % 100).toString().padStart(2, '0');
  const symbol = currencyCode === 'EUR' ? '€' : currencyCode;
  return `${negative ? '-' : ''}${major},${cents} ${symbol}`;
}

/** Rend une date en JJ/MM/AAAA HH:MM (locale figée, déterministe). */
export function formatDateTime(value: string | Date): string {
  const d = value instanceof Date ? value : new Date(value);
  if (isNaN(d.getTime())) return String(value);
  const p = (n: number) => n.toString().padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/**
 * Construit les lignes de récap d'une vente à partir des totaux FIGÉS.
 * Propriété testée : echo verbatim — aucune somme des lignes, aucun recalcul.
 */
export function buildSaleSummaryRows(input: SaleDuplicataInput): SummaryRow[] {
  const c = input.currencyCode;
  return [
    { label: 'Sous-total', value: formatMoney(input.subtotalMinorUnits, c) },
    { label: 'Remise', value: formatMoney(input.discountTotalMinorUnits, c) },
    { label: 'TVA', value: formatMoney(input.taxTotalMinorUnits, c) },
    { label: 'TOTAL', value: formatMoney(input.totalMinorUnits, c) },
  ];
}

/** WinAnsi-safe : remplace les caractères non encodables par '?'. */
function safe(s: unknown): string {
  return String(s ?? '').replace(/[^\x20-\x7E -ÿ€]/g, '?');
}

/* ── Service ─────────────────────────────────────────────────────────────── */

@Injectable()
export class PdfService {
  /** Duplicata d'un ticket de vente FIGÉ (mention DUPLICATA visible). */
  async renderSaleDuplicata(input: SaleDuplicataInput): Promise<Uint8Array> {
    const { doc, page, font, bold } = await this.newDoc();
    let y = this.header(page, bold, font, input.storeName, [
      input.storeAddress,
      input.siret ? `SIRET ${input.siret}` : undefined,
      input.tvaIntracom ? `TVA ${input.tvaIntracom}` : undefined,
    ]);

    // Bandeau DUPLICATA (anti-fraude : un duplicata n'est jamais l'original).
    y -= 6;
    page.drawText('DUPLICATA', { x: 40, y, size: 16, font: bold, color: rgb(0.8, 0.1, 0.1) });
    y -= 22;
    page.drawText(safe(`Ticket ${input.ticketNumber}`), { x: 40, y, size: 11, font: bold });
    y -= 14;
    page.drawText(safe(formatDateTime(input.createdAt)), { x: 40, y, size: 10, font });
    if (input.employeeName) {
      y -= 14;
      page.drawText(safe(`Caissier : ${input.employeeName}`), { x: 40, y, size: 10, font });
    }

    y -= 22;
    this.line(page, y);
    y -= 16;
    page.drawText('Article', { x: 40, y, size: 9, font: bold });
    page.drawText('Qté', { x: 320, y, size: 9, font: bold });
    page.drawText('PU', { x: 380, y, size: 9, font: bold });
    page.drawText('Total', { x: 480, y, size: 9, font: bold });
    y -= 6;
    this.line(page, y);

    for (const l of input.lines) {
      y -= 16;
      if (y < 120) y = this.continuePage(doc, page, font).y;
      page.drawText(safe(l.productName).slice(0, 48), { x: 40, y, size: 9, font });
      page.drawText(String(l.quantity), { x: 320, y, size: 9, font });
      page.drawText(formatMoney(l.unitPriceMinorUnits, input.currencyCode), { x: 380, y, size: 9, font });
      page.drawText(formatMoney(l.lineTotalMinorUnits, input.currencyCode), { x: 480, y, size: 9, font });
    }

    y -= 10;
    this.line(page, y);
    for (const row of buildSaleSummaryRows(input)) {
      y -= 16;
      const isTotal = row.label === 'TOTAL';
      page.drawText(row.label, { x: 380, y, size: isTotal ? 11 : 9, font: isTotal ? bold : font });
      page.drawText(row.value, { x: 480, y, size: isTotal ? 11 : 9, font: isTotal ? bold : font });
    }

    if (input.payments?.length) {
      y -= 22;
      page.drawText('Paiements', { x: 40, y, size: 9, font: bold });
      for (const p of input.payments) {
        y -= 14;
        page.drawText(safe(p.method), { x: 40, y, size: 9, font });
        page.drawText(formatMoney(p.amountMinorUnits, input.currencyCode), { x: 480, y, size: 9, font });
      }
    }

    this.footer(page, font, input.hashChainCurrent, input.footerMessage);
    return doc.save();
  }

  /** Justificatif d'avoir / bon d'achat FIGÉ. */
  async renderCreditNoteJustificatif(input: CreditNoteJustificatifInput): Promise<Uint8Array> {
    const { doc, page, font, bold } = await this.newDoc();
    let y = this.header(page, bold, font, input.storeName, []);
    y -= 6;
    const title = input.origin === 'gift_card' ? "BON D'ACHAT" : "JUSTIFICATIF D'AVOIR";
    page.drawText(title, { x: 40, y, size: 15, font: bold, color: rgb(0.1, 0.3, 0.6) });
    y -= 22;
    page.drawText(safe(`N° ${input.number}`), { x: 40, y, size: 11, font: bold });
    y -= 14;
    page.drawText(safe(formatDateTime(input.createdAt)), { x: 40, y, size: 10, font });
    if (input.originalTicketNumber) {
      y -= 14;
      page.drawText(safe(`Ticket d'origine : ${input.originalTicketNumber}`), { x: 40, y, size: 10, font });
    }
    if (input.employeeName) {
      y -= 14;
      page.drawText(safe(`Émis par : ${input.employeeName}`), { x: 40, y, size: 10, font });
    }
    if (input.reason) {
      y -= 14;
      page.drawText(safe(`Motif : ${input.reason}`).slice(0, 80), { x: 40, y, size: 10, font });
    }

    y -= 24;
    this.line(page, y);
    const c = input.currencyCode;
    const rows: SummaryRow[] = [
      { label: 'Montant', value: formatMoney(input.totalMinorUnits, c) },
      { label: 'Solde restant', value: formatMoney(input.remainingMinorUnits, c) },
    ];
    if (input.refundMethod) rows.push({ label: 'Mode', value: safe(input.refundMethod) });
    for (const row of rows) {
      y -= 18;
      page.drawText(row.label, { x: 40, y, size: 10, font });
      page.drawText(row.value, { x: 200, y, size: 10, font: bold });
    }

    this.footer(page, font, input.hashChainCurrent ?? undefined);
    return doc.save();
  }

  /** Export PDF d'un Z-report FIGÉ. */
  async renderZReport(input: ZReportInput): Promise<Uint8Array> {
    const { doc, page, font, bold } = await this.newDoc();
    let y = this.header(page, bold, font, input.storeName, []);
    y -= 6;
    page.drawText(`RAPPORT Z — ${safe(input.date)}`, { x: 40, y, size: 15, font: bold });
    y -= 26;
    this.line(page, y);
    const c = input.currencyCode;
    const rows: SummaryRow[] = [
      { label: 'Transactions', value: String(input.transactionCount) },
      { label: 'Chiffre d\'affaires', value: formatMoney(input.totalRevenueMinorUnits, c) },
      { label: 'TVA', value: formatMoney(input.totalTaxMinorUnits, c) },
      { label: 'Remises', value: formatMoney(input.discountTotalMinorUnits, c) },
      { label: 'Espèces', value: formatMoney(input.cashTotalMinorUnits, c) },
      { label: 'Carte', value: formatMoney(input.cardTotalMinorUnits, c) },
    ];
    if (typeof input.averageBasketMinorUnits === 'number') {
      rows.push({ label: 'Panier moyen', value: formatMoney(input.averageBasketMinorUnits, c) });
    }
    for (const row of rows) {
      y -= 20;
      page.drawText(row.label, { x: 40, y, size: 11, font });
      page.drawText(row.value, { x: 300, y, size: 11, font: bold });
    }
    this.footer(page, font, input.hash);
    return doc.save();
  }

  /* ── Primitives de mise en page ───────────────────────────────────────── */

  private async newDoc(): Promise<{ doc: PDFDocument; page: PDFPage; font: PDFFont; bold: PDFFont }> {
    const doc = await PDFDocument.create();
    doc.setProducer('CAISSE POS');
    doc.setCreator('CAISSE POS');
    const page = doc.addPage([595.28, 841.89]); // A4 portrait
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const bold = await doc.embedFont(StandardFonts.HelveticaBold);
    return { doc, page, font, bold };
  }

  private header(page: PDFPage, bold: PDFFont, font: PDFFont, storeName: string, sub: (string | undefined)[]): number {
    let y = 800;
    page.drawText(safe(storeName), { x: 40, y, size: 18, font: bold });
    for (const s of sub) {
      if (!s) continue;
      y -= 14;
      page.drawText(safe(s), { x: 40, y, size: 9, font });
    }
    return y - 18;
  }

  private line(page: PDFPage, y: number): void {
    page.drawLine({ start: { x: 40, y }, end: { x: 555, y }, thickness: 0.5, color: rgb(0.7, 0.7, 0.7) });
  }

  private continuePage(doc: PDFDocument, _old: PDFPage, _font: PDFFont): { page: PDFPage; y: number } {
    const page = doc.addPage([595.28, 841.89]);
    return { page, y: 800 };
  }

  private footer(page: PDFPage, font: PDFFont, hash?: string, message?: string): void {
    if (message) page.drawText(safe(message), { x: 40, y: 70, size: 9, font });
    if (hash) {
      page.drawText('Empreinte (hash) :', { x: 40, y: 52, size: 7, font });
      page.drawText(safe(hash).slice(0, 80), { x: 40, y: 42, size: 7, font, color: rgb(0.4, 0.4, 0.4) });
    }
    page.drawText('Document genere par CAISSE POS', { x: 40, y: 28, size: 7, font, color: rgb(0.6, 0.6, 0.6) });
  }
}
