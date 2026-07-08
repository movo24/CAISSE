import { NotFoundException } from '@nestjs/common';
import { DocumentsController } from './documents.controller';
import { PdfService } from './pdf.service';

/**
 * PR #31 — exposition réseau des documents PDF. Invariants :
 * - lecture + rendu VERBATIM (les totaux figés partent tels quels au PdfService) ;
 * - tenant-scoping délégué aux services métier (storeId du JWT, jamais du client) ;
 * - l'export Z LIT un Z existant (404 sinon) — jamais de génération implicite.
 */

const SALE = {
  id: 'sale-1',
  ticketNumber: 'T-000042',
  createdAt: new Date('2026-07-01T10:00:00Z'),
  employeeNameSnapshot: 'Alice',
  subtotalMinorUnits: 1000,
  discountTotalMinorUnits: 100,
  taxTotalMinorUnits: 150,
  totalMinorUnits: 900,
  hashChainCurrent: 'abc123',
  lineItems: [{ productName: 'Choco', quantity: 2, unitPriceMinorUnits: 500, lineTotalMinorUnits: 1000, taxRate: 20 }],
  payments: [{ method: 'cash', amountMinorUnits: 900 }],
};

const CN = {
  code: 'AV-0001',
  origin: 'return',
  originalTicketNumber: 'T-000042',
  createdAt: new Date('2026-07-01T11:00:00Z'),
  currencyCode: 'EUR',
  totalMinorUnits: 900,
  remainingMinorUnits: 900,
  refundMethod: 'store_credit',
  reason: 'défectueux',
  hashChainCurrent: 'def456',
};

const Z = {
  date: '2026-07-01',
  transactionCount: 12,
  currencyCode: 'EUR',
  totalRevenueMinorUnits: 123400,
  totalTaxMinorUnits: 20567,
  discountTotalMinorUnits: 500,
  cashTotalMinorUnits: 60000,
  cardTotalMinorUnits: 63400,
  averageBasketMinorUnits: 10283,
};

function makeController() {
  const pdf = { renderSaleDuplicata: jest.fn(), renderCreditNoteJustificatif: jest.fn(), renderZReport: jest.fn() };
  pdf.renderSaleDuplicata.mockResolvedValue(new Uint8Array([1]));
  pdf.renderCreditNoteJustificatif.mockResolvedValue(new Uint8Array([2]));
  pdf.renderZReport.mockResolvedValue(new Uint8Array([3]));
  const sales = { findOne: jest.fn().mockResolvedValue(SALE) };
  const returns = { findOne: jest.fn().mockResolvedValue(CN) };
  const reports = { getZReport: jest.fn().mockResolvedValue(Z), generateZReport: jest.fn() };
  const storeRepo = { findOne: jest.fn().mockResolvedValue({ name: 'Wesley', address: '1 rue', siret: 'S', tvaIntracom: 'FR1', currencyCode: 'EUR' }) };
  const ctrl = new DocumentsController(
    pdf as unknown as PdfService,
    sales as any,
    returns as any,
    reports as any,
    storeRepo as any,
  );
  const res = { set: jest.fn(), send: jest.fn() } as any;
  const req = { user: { storeId: 'store-1', role: 'manager', employeeId: 'emp-1' } };
  return { ctrl, pdf, sales, returns, reports, res, req };
}

describe('DocumentsController (PR #31)', () => {
  it('duplicata: fetches the sale TENANT-SCOPED and passes the frozen totals verbatim', async () => {
    const { ctrl, pdf, sales, res, req } = makeController();
    await ctrl.saleDuplicata('sale-1', req, res);
    expect(sales.findOne).toHaveBeenCalledWith('sale-1', 'store-1'); // storeId du JWT
    const input = pdf.renderSaleDuplicata.mock.calls[0][0];
    expect(input.subtotalMinorUnits).toBe(1000);
    expect(input.discountTotalMinorUnits).toBe(100);
    expect(input.taxTotalMinorUnits).toBe(150);
    expect(input.totalMinorUnits).toBe(900); // verbatim — jamais recalculé
    expect(input.hashChainCurrent).toBe('abc123');
    expect(res.set).toHaveBeenCalledWith(expect.objectContaining({ 'Content-Type': 'application/pdf' }));
  });

  it('justificatif avoir: tenant-scoped, chained hash + reason carried verbatim', async () => {
    const { ctrl, pdf, returns, res, req } = makeController();
    await ctrl.creditNoteJustificatif('cn-1', req, res);
    expect(returns.findOne).toHaveBeenCalledWith('cn-1', 'store-1');
    const input = pdf.renderCreditNoteJustificatif.mock.calls[0][0];
    expect(input.number).toBe('AV-0001');
    expect(input.totalMinorUnits).toBe(900);
    expect(input.remainingMinorUnits).toBe(900);
    expect(input.hashChainCurrent).toBe('def456');
  });

  it('export Z: READS the sealed Z (never generates) and renders it verbatim', async () => {
    const { ctrl, pdf, reports, res, req } = makeController();
    await ctrl.zReport('2026-07-01', req, res);
    expect(reports.getZReport).toHaveBeenCalledWith('store-1', '2026-07-01');
    expect(reports.generateZReport).not.toHaveBeenCalled(); // immutabilité Z
    const input = pdf.renderZReport.mock.calls[0][0];
    expect(input.totalRevenueMinorUnits).toBe(123400);
    expect(input.cashTotalMinorUnits).toBe(60000);
    expect(input.cardTotalMinorUnits).toBe(63400);
  });

  it('missing Z → 404, nothing rendered (never an implicit generation)', async () => {
    const { ctrl, pdf, reports, res, req } = makeController();
    reports.getZReport.mockResolvedValue(null); // le Z n'a pas été généré
    await expect(ctrl.zReport('2026-07-02', req, res)).rejects.toThrow(NotFoundException);
    expect(reports.generateZReport).not.toHaveBeenCalled();
    expect(pdf.renderZReport).not.toHaveBeenCalled();
    expect(res.send).not.toHaveBeenCalled();
  });
});
