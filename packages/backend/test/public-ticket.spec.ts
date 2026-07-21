/**
 * Ticket numérique public (/ticket/:token) — refonte ticket The Wesley.
 *
 * Couvre :
 *  - propriétés du jeton public (opacité, non-devinabilité, unicité) et ses
 *    invariants d'implémentation dans createSale (généré DANS la transaction,
 *    HORS de l'empreinte de hash fiscale — modèle session_id/terminal_id) ;
 *  - PublicTicketService : 404 opaque (format invalide = inconnu, AUCUNE
 *    requête DB sur format invalide → pas d'énumération), assemblage des
 *    données (libellés paiement, ventilation TVA, avoirs liés), zone
 *    recommandations (catalogue réel du magasin uniquement, isolation par
 *    storeId) ;
 *  - page HTML : échappement XSS, statut annulé/remboursé sans réécrire le
 *    ticket, aucune fuite d'identifiant interne.
 */
import { randomBytes } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { NotFoundException } from '@nestjs/common';
import { PublicTicketService } from '../src/modules/public-ticket/public-ticket.service';
import { buildTicketPageHtml } from '../src/modules/public-ticket/ticket-page.html';
import { computeVatBreakdown } from '../src/modules/public-ticket/vat-breakdown.util';

const TOKEN_RE = /^[A-Za-z0-9_-]{16,64}$/;

function makeService(overrides: {
  sale?: any;
  store?: any;
  creditNotes?: any[];
  products?: any[];
} = {}) {
  const saleRepo = {
    findOne: jest.fn(async ({ where }: any) =>
      overrides.sale && where?.publicToken === overrides.sale.publicToken ? overrides.sale : null,
    ),
  };
  const storeRepo = { findOne: jest.fn(async (_opts: any) => overrides.store ?? null) };
  const cnRepo = { find: jest.fn(async (_opts: any) => overrides.creditNotes ?? []) };
  const productRepo = { find: jest.fn(async (_opts: any) => overrides.products ?? []) };
  const pdf = { renderSaleDuplicata: jest.fn(async (_input: any) => new Uint8Array([1, 2, 3])) };
  const service = new PublicTicketService(
    saleRepo as any,
    storeRepo as any,
    cnRepo as any,
    productRepo as any,
    pdf as any,
  );
  return { service, saleRepo, storeRepo, cnRepo, productRepo, pdf };
}

const baseSale = {
  id: 'a3d1f1e2-0000-4000-8000-000000000001',
  storeId: 'store-1',
  publicToken: 'tok_ABCDEFGHIJKLMNOPQRSTUVWXYZ012345'.slice(0, 32),
  ticketNumber: 'T-000042',
  status: 'completed',
  currencyCode: 'EUR',
  subtotalMinorUnits: 2000,
  discountTotalMinorUnits: 0,
  // 700×5,5/105,5 → 36 + 1300×20/120 → 217 = 253 (formule du moteur de vente)
  taxTotalMinorUnits: 253,
  totalMinorUnits: 2000,
  employeeNameSnapshot: 'Awa',
  createdAt: new Date('2026-07-18T10:00:00Z'),
  completedAt: new Date('2026-07-18T10:00:05Z'),
  lineItems: [
    { productName: 'Bonbon fraise <script>alert(1)</script>', quantity: 2, unitPriceMinorUnits: 350, discountMinorUnits: 0, lineTotalMinorUnits: 700, taxRate: '5.50' },
    { productName: 'Peluche Wesley édition été — çàé', quantity: 1, unitPriceMinorUnits: 1300, discountMinorUnits: 0, lineTotalMinorUnits: 1300, taxRate: 20 },
  ],
  payments: [
    { method: 'cash', amountMinorUnits: 1500 },
    { method: 'card', amountMinorUnits: 500 },
  ],
};

const baseStore = {
  id: 'store-1',
  name: 'The Wesley — Test',
  operatingCompanyName: null,
  address: '1 rue du Test',
  addressExtra: null,
  postalCode: '94000',
  city: 'Créteil',
  phone: null,
  email: null,
  websiteUrl: null,
  siret: null,
  rcs: null,
  tvaIntracom: null,
  receiptLogoUrl: null,
  timezone: 'Europe/Paris',
  receiptShowRecommendations: false,
  receiptRecommendationTarget: null,
  receiptRecommendationCategoryId: null,
};

describe('Jeton public de ticket — propriétés', () => {
  const gen = () => randomBytes(24).toString('base64url');

  it('32 caractères base64url, format accepté par la route publique', () => {
    for (let i = 0; i < 50; i++) {
      const t = gen();
      expect(t).toHaveLength(32);
      expect(t).toMatch(TOKEN_RE);
    }
  });

  it('non énumérable : 5000 tirages sans collision (192 bits d’entropie)', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 5000; i++) seen.add(gen());
    expect(seen.size).toBe(5000);
  });

  it("createSale : jeton généré DANS la transaction, HORS de l'empreinte de hash", () => {
    const src = fs.readFileSync(
      path.join(__dirname, '../src/modules/sales/sales.service.ts'),
      'utf8',
    );
    // Généré côté serveur, par vente.
    expect(src).toMatch(/sale\.publicToken = randomBytes\(24\)\.toString\('base64url'\)/);
    // JAMAIS dans l'empreinte fiscale : le bloc saleDataForHash ne cite pas le jeton.
    const hashBlock = src.slice(src.indexOf('saleDataForHash = JSON.stringify'), src.indexOf('const currentHash'));
    expect(hashBlock).not.toContain('publicToken');
  });

  it('entité Sale : colonne additive nullable — aucune vente existante réécrite', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '../src/database/entities/sale.entity.ts'),
      'utf8',
    );
    expect(src).toMatch(/name: 'public_token'[\s\S]{0,80}nullable: true/);
  });
});

describe('PublicTicketService — accès par jeton', () => {
  it('404 opaque sur format invalide, SANS requête DB (anti-énumération)', async () => {
    const { service, saleRepo } = makeService();
    for (const bad of ['', 'short', 'a'.repeat(65), 'jeton invalide!', '../../etc', 'tok;DROP TABLE']) {
      await expect(service.getTicketByToken(bad)).rejects.toThrow(NotFoundException);
    }
    expect(saleRepo.findOne).not.toHaveBeenCalled();
  });

  it('404 opaque identique sur jeton inconnu (même message que format invalide)', async () => {
    const { service } = makeService();
    const err1 = await service.getTicketByToken('x'.repeat(32)).catch((e) => e);
    const err2 = await service.getTicketByToken('!!').catch((e) => e);
    expect(err1.message).toBe(err2.message);
  });

  it('assemble le ticket : libellés paiement, ventilation TVA, vendeur', async () => {
    const { service } = makeService({ sale: baseSale, store: baseStore });
    const data = await service.getTicketByToken(baseSale.publicToken);
    expect(data.ticketNumber).toBe('T-000042');
    expect(data.payments.map((p) => p.label)).toEqual(['Espèces', 'Carte bancaire']);
    expect(data.cashier).toBe('Awa');
    // Ventilation : 2 taux, sommes cohérentes avec la formule du moteur de vente.
    expect(data.vatBreakdown).toEqual([
      { rate: 5.5, ttcMinorUnits: 700, tvaMinorUnits: Math.round(700 * (5.5 / 105.5)), htMinorUnits: 700 - Math.round(700 * (5.5 / 105.5)) },
      { rate: 20, ttcMinorUnits: 1300, tvaMinorUnits: Math.round(1300 * (20 / 120)), htMinorUnits: 1300 - Math.round(1300 * (20 / 120)) },
    ]);
    const sumTva = data.vatBreakdown.reduce((s, v) => s + v.tvaMinorUnits, 0);
    expect(sumTva).toBe(baseSale.taxTotalMinorUnits);
  });

  it('liste les avoirs rattachés SANS modifier le ticket d’origine', async () => {
    const cn = { code: 'AV-0001', type: 'refund', totalMinorUnits: 700, createdAt: new Date() };
    const { service } = makeService({ sale: baseSale, store: baseStore, creditNotes: [cn] });
    const data = await service.getTicketByToken(baseSale.publicToken);
    expect(data.creditNotes).toEqual([expect.objectContaining({ code: 'AV-0001', type: 'refund' })]);
    expect(data.totalMinorUnits).toBe(2000); // montants d'origine intacts
    expect(data.status).toBe('completed');
  });

  it('recommandations désactivées par défaut → liste vide, aucun appel produits', async () => {
    const { service, productRepo } = makeService({ sale: baseSale, store: baseStore });
    const data = await service.getTicketByToken(baseSale.publicToken);
    expect(data.recommendations.enabled).toBe(false);
    expect(data.recommendations.items).toEqual([]);
    expect(productRepo.find).not.toHaveBeenCalled();
  });

  it('recommandations activées → catalogue RÉEL du magasin uniquement (isolation storeId)', async () => {
    const store = { ...baseStore, receiptShowRecommendations: true, receiptRecommendationTarget: 'new', websiteUrl: 'https://thewesleys.fr' };
    const products = [{ name: 'Nouveauté', imageUrl: null, priceMinorUnits: 500, oldPriceMinorUnits: null }];
    const { service, productRepo } = makeService({ sale: baseSale, store, products });
    const data = await service.getTicketByToken(baseSale.publicToken);
    expect(data.recommendations.enabled).toBe(true);
    expect(data.recommendations.items).toHaveLength(1);
    const where = productRepo.find.mock.calls[0][0].where;
    expect(where.storeId).toBe('store-1'); // jamais un autre magasin
    expect(where.isActive).toBe(true);
  });

  it('cible « category » → filtre sur la catégorie configurée', async () => {
    const store = {
      ...baseStore,
      receiptShowRecommendations: true,
      receiptRecommendationTarget: 'category',
      receiptRecommendationCategoryId: 'cat-42',
    };
    const { service, productRepo } = makeService({ sale: baseSale, store, products: [] });
    await service.getTicketByToken(baseSale.publicToken);
    expect(productRepo.find.mock.calls[0][0].where.categoryId).toBe('cat-42');
  });

  it('PDF : rendu via PdfService (montants verbatim), 404 opaque sinon', async () => {
    const { service, pdf } = makeService({ sale: baseSale, store: baseStore });
    const res = await service.getTicketPdf(baseSale.publicToken);
    expect(res.filename).toBe('ticket-T-000042.pdf');
    const input = pdf.renderSaleDuplicata.mock.calls[0][0];
    expect(input.totalMinorUnits).toBe(2000);
    expect(input.taxTotalMinorUnits).toBe(253);
    await expect(service.getTicketPdf('inconnu-token-0123456789abcdef')).rejects.toThrow(NotFoundException);
  });
});

describe('Page HTML du ticket numérique', () => {
  async function render(overrides: Partial<typeof baseSale> = {}, creditNotes: any[] = []) {
    const sale = { ...baseSale, ...overrides };
    const { service } = makeService({ sale, store: baseStore, creditNotes });
    const data = await service.getTicketByToken(sale.publicToken);
    return buildTicketPageHtml(data, sale.publicToken);
  }

  it('échappe le HTML des noms de produits (anti-XSS)', async () => {
    const html = await render();
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('affiche accents et contenu attendu (articles, TVA, TOTAL TTC, paiements)', async () => {
    const html = await render();
    expect(html).toContain('Peluche Wesley édition été — çàé');
    expect(html).toContain('TOTAL TTC');
    expect(html).toContain('TVA 5,5');
    expect(html).toContain('Espèces');
    expect(html).toContain('T-000042');
  });

  it('ne fuit AUCUN identifiant interne (id de vente, storeId)', async () => {
    const html = await render();
    expect(html).not.toContain(baseSale.id);
    expect(html).not.toContain('store-1');
  });

  it('statut « Ticket annulé » pour une vente voided — ticket d’origine affiché', async () => {
    const html = await render({ status: 'voided' });
    expect(html).toContain('Ticket annulé');
    expect(html).toContain('T-000042'); // le ticket d'origine reste consultable
  });

  it('statut remboursement/avoir affiché sans réécrire le ticket', async () => {
    const html = await render({}, [
      { code: 'AV-0001', type: 'refund', totalMinorUnits: 2000, createdAt: new Date() },
    ]);
    expect(html).toContain('Remboursement total');
    expect(html).toContain('AV-0001');
    expect(html).toContain('TOTAL TTC'); // montants d'origine toujours là
  });

  it('lien PDF construit sur le jeton public uniquement', async () => {
    const html = await render();
    expect(html).toContain(`/ticket/${baseSale.publicToken}/pdf`);
  });

  it('page en lecture seule : aucun formulaire, aucun script', async () => {
    const html = await render();
    expect(html).not.toMatch(/<form/i);
    expect(html).not.toMatch(/<script/i);
  });
});

describe('computeVatBreakdown — ventilation par taux', () => {
  it('regroupe par taux et trie croissant', () => {
    const rows = computeVatBreakdown([
      { lineTotalMinorUnits: 1200, taxRate: 20 },
      { lineTotalMinorUnits: 700, taxRate: '5.50' },
      { lineTotalMinorUnits: 300, taxRate: 20 },
    ]);
    expect(rows.map((r) => r.rate)).toEqual([5.5, 20]);
    expect(rows[1].ttcMinorUnits).toBe(1500);
  });

  it('HT + TVA = TTC sur chaque ligne de ventilation', () => {
    const rows = computeVatBreakdown([
      { lineTotalMinorUnits: 999, taxRate: 5.5 },
      { lineTotalMinorUnits: 1234, taxRate: 10 },
      { lineTotalMinorUnits: 777, taxRate: 20 },
    ]);
    for (const r of rows) expect(r.htMinorUnits + r.tvaMinorUnits).toBe(r.ttcMinorUnits);
  });

  it('taux 0 et taux invalide → TVA nulle, jamais NaN', () => {
    const rows = computeVatBreakdown([
      { lineTotalMinorUnits: 500, taxRate: 0 },
      { lineTotalMinorUnits: 500, taxRate: 'abc' as any },
    ]);
    for (const r of rows) {
      expect(Number.isFinite(r.tvaMinorUnits)).toBe(true);
      expect(r.tvaMinorUnits).toBe(0);
    }
  });

  it('même formule que le moteur de vente : round(ttc × t / (100 + t)) par ligne', () => {
    const rows = computeVatBreakdown([{ lineTotalMinorUnits: 700, taxRate: 5.5 }]);
    expect(rows[0].tvaMinorUnits).toBe(Math.round(700 * (5.5 / (100 + 5.5))));
  });
});
