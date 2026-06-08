import {
  PdfService,
  formatMoney,
  buildSaleSummaryRows,
  SaleDuplicataInput,
} from './pdf.service';

/** Un PDF valide commence par l'en-tête magique %PDF-. */
function isPdf(bytes: Uint8Array): boolean {
  const head = Buffer.from(bytes.slice(0, 5)).toString('latin1');
  return head === '%PDF-';
}

describe('PdfService', () => {
  const service = new PdfService();

  describe('formatMoney (pur, sans calcul métier)', () => {
    it('formate des centimes en devise FR', () => {
      expect(formatMoney(2990, 'EUR')).toBe('29,90 €');
      expect(formatMoney(0, 'EUR')).toBe('0,00 €');
      expect(formatMoney(5, 'EUR')).toBe('0,05 €');
      expect(formatMoney(-150, 'EUR')).toBe('-1,50 €');
    });
    it('garde le code devise pour les non-EUR', () => {
      expect(formatMoney(1000, 'USD')).toBe('10,00 USD');
    });
  });

  describe('non-recalcul (garantie fiscale)', () => {
    it("echo verbatim les totaux figés, MEME s'ils ne somment pas les lignes", () => {
      // Lignes volontairement incohérentes avec les totaux : le service NE DOIT
      // PAS recalculer. Il imprime les totaux figés tels quels.
      const input: SaleDuplicataInput = {
        storeName: 'Boutique Paris',
        ticketNumber: 'T-000001',
        createdAt: '2026-06-07T20:36:00.000Z',
        currencyCode: 'EUR',
        lines: [
          { productName: 'T-Shirt Blanc', quantity: 1, unitPriceMinorUnits: 2990, lineTotalMinorUnits: 2990 },
        ],
        subtotalMinorUnits: 111, // incohérent exprès
        discountTotalMinorUnits: 222,
        taxTotalMinorUnits: 333,
        totalMinorUnits: 444,
      };
      const rows = buildSaleSummaryRows(input);
      expect(rows).toEqual([
        { label: 'Sous-total', value: '1,11 €' },
        { label: 'Remise', value: '2,22 €' },
        { label: 'TVA', value: '3,33 €' },
        { label: 'TOTAL', value: '4,44 €' },
      ]);
    });
  });

  describe('rendu PDF', () => {
    const sale: SaleDuplicataInput = {
      storeName: 'Boutique Paris',
      storeAddress: '42 Rue de Rivoli, 75001 Paris',
      siret: '12345678901234',
      tvaIntracom: 'FR 12 123456789',
      ticketNumber: 'T-000001',
      createdAt: '2026-06-07T20:36:00.000Z',
      employeeName: 'Admin Manager',
      currencyCode: 'EUR',
      lines: [
        { productName: 'T-Shirt Blanc', quantity: 1, unitPriceMinorUnits: 2990, lineTotalMinorUnits: 2990, taxRate: 20 },
        { productName: 'Café crème (à emporter)', quantity: 2, unitPriceMinorUnits: 250, lineTotalMinorUnits: 500 },
      ],
      subtotalMinorUnits: 3490,
      discountTotalMinorUnits: 0,
      taxTotalMinorUnits: 582,
      totalMinorUnits: 3490,
      payments: [{ method: 'cash', amountMinorUnits: 3490 }],
      hashChainCurrent: 'a1b2c3d4e5f6',
      footerMessage: 'Merci de votre visite !',
    };

    it('produit un duplicata de vente valide (mention DUPLICATA)', async () => {
      const bytes = await service.renderSaleDuplicata(sale);
      expect(isPdf(bytes)).toBe(true);
      expect(bytes.length).toBeGreaterThan(800);
    });

    it('produit un justificatif d\'avoir valide', async () => {
      const bytes = await service.renderCreditNoteJustificatif({
        storeName: 'Boutique Paris',
        number: 'AV-000001',
        origin: 'return',
        originalTicketNumber: 'T-000001',
        createdAt: '2026-06-07T21:00:00.000Z',
        employeeName: 'Admin Manager',
        currencyCode: 'EUR',
        totalMinorUnits: 2990,
        remainingMinorUnits: 2990,
        refundMethod: 'store_credit',
        reason: 'Article défectueux',
        hashChainCurrent: 'deadbeef',
      });
      expect(isPdf(bytes)).toBe(true);
      expect(bytes.length).toBeGreaterThan(800);
    });

    it('produit un export Z-report valide', async () => {
      const bytes = await service.renderZReport({
        storeName: 'Boutique Paris',
        date: '2026-06-07',
        transactionCount: 1,
        currencyCode: 'EUR',
        totalRevenueMinorUnits: 3490,
        totalTaxMinorUnits: 582,
        discountTotalMinorUnits: 0,
        cashTotalMinorUnits: 3490,
        cardTotalMinorUnits: 0,
        averageBasketMinorUnits: 3490,
        hash: 'zhash123',
      });
      expect(isPdf(bytes)).toBe(true);
      expect(bytes.length).toBeGreaterThan(800);
    });

    it('ne plante pas sur des caractères non-WinAnsi (emoji)', async () => {
      const bytes = await service.renderSaleDuplicata({
        ...sale,
        lines: [{ productName: 'Bonbons 🍬 spéciaux', quantity: 1, unitPriceMinorUnits: 100, lineTotalMinorUnits: 100 }],
      });
      expect(isPdf(bytes)).toBe(true);
    });
  });
});
