/**
 * D1 (TECHNICAL_DEBT) — caractérisation du reversal fiscal d'une vente CASH via
 * `createReturn` (remboursement espèces), le chemin imposé par le guard
 * `void-cash-realized`.
 *
 * CES TESTS DOCUMENTENT LE COMPORTEMENT ACTUEL — ils ne le conçoivent pas.
 * La décision fiscal-design (un retour cash doit-il écrire un maillon
 * `fiscal_journal` comme le void ? cf. D17 « event opposable → fiscal_journal »)
 * appartient à l'owner. Ici on ÉPINGLE les faits pour que tout changement
 * silencieux casse la CI, et on ferme le point (2) de D1 (spec end-to-end).
 */
import './helpers/env-setup';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { createHash } from 'crypto';

import { createPgMemDataSource, loadAllEntities } from './helpers/pgmem';
import { SalesModule } from '../src/modules/sales/sales.module';
import { ReturnsModule } from '../src/modules/returns/returns.module';
import { CacheModule } from '../src/common/cache/cache.module';
import { MessagingModule } from '../src/common/messaging/messaging.module';
import { RealtimeModule } from '../src/common/realtime/realtime.module';
import { TimewinModule } from '../src/modules/timewin/timewin.module';
import { SalesService } from '../src/modules/sales/sales.service';
import { ReturnsService } from '../src/modules/returns/returns.service';
import { StoreEntity } from '../src/database/entities/store.entity';
import { ProductEntity } from '../src/database/entities/product.entity';
import { FiscalJournalEntity } from '../src/database/entities/fiscal-journal.entity';
import { CreditNoteEntity } from '../src/database/entities/credit-note.entity';

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
const GENESIS = '0'.repeat(64);
const EAN = '5000000000001';

describe('Fiscal D1 — retour CASH via createReturn (caractérisation end-to-end)', () => {
  let moduleRef: TestingModule;
  let ds: DataSource;
  let sales: SalesService;
  let returns: ReturnsService;
  const STORE_ID = uuidv4();
  const EMP_ID = uuidv4();
  const SNAP = { employeeName: 'Alice', employeeRole: 'admin', maxDiscount: 100 };

  beforeAll(async () => {
    const { dataSource } = createPgMemDataSource();
    moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        TypeOrmModule.forRootAsync({
          useFactory: () => ({ type: 'postgres', entities: loadAllEntities() as any, synchronize: true }),
          dataSourceFactory: async () => (dataSource.isInitialized ? dataSource : dataSource.initialize()),
        }),
        CacheModule, MessagingModule, RealtimeModule, TimewinModule, SalesModule, ReturnsModule,
      ],
    }).compile();
    ds = moduleRef.get(DataSource);
    sales = moduleRef.get(SalesService);
    returns = moduleRef.get(ReturnsService);

    await ds.getRepository(StoreEntity).save({ id: STORE_ID, name: 'S', storeCode: 'S1', currencyCode: 'EUR', isActive: true } as any);
    await ds.getRepository(ProductEntity).save({
      id: uuidv4(), storeId: STORE_ID, ean: EAN, name: 'Article 5€',
      priceMinorUnits: 500, taxRate: 20, stockQuantity: 1000, stockAlertThreshold: 5, stockCriticalThreshold: 2, isActive: true,
    } as any);
  });

  afterAll(async () => { await moduleRef?.close(); });

  // pg-mem mis-types GREATEST(0, stock-$1); replenish before each sale.
  const freshStock = () => ds.getRepository(ProductEntity).update({ storeId: STORE_ID }, { stockQuantity: 1000 });
  const stockOf = async () => (await ds.getRepository(ProductEntity).findOne({ where: { storeId: STORE_ID, ean: EAN } }))!.stockQuantity;

  async function cashSale(qty = 1): Promise<any> {
    await freshStock();
    const dto = { items: [{ ean: EAN, quantity: qty }], payments: [{ method: 'cash', amountMinorUnits: 500 * qty }] };
    return sales.createSale(STORE_ID, EMP_ID, dto as any, SNAP);
  }

  it('D1.0 — le guard impose ce chemin : void d\'une vente cash réalisée REFUSÉ', async () => {
    const sale = await cashSale();
    await expect(sales.voidSale(sale.id, EMP_ID, STORE_ID, 'admin')).rejects.toThrow(/espèces|cash/i);
    const after: any = await ds.getRepository('sales').findOne({ where: { id: sale.id } });
    expect(after.status).toBe('completed'); // rien n'a bougé
  });

  it('D1.1 — remboursement cash → avoir type refund, soldé, chaîné et auto-cohérent', async () => {
    const sale = await cashSale();
    const cn: any = await returns.createReturn(
      STORE_ID, EMP_ID,
      { originalSaleId: sale.id, items: [{ lineItemId: sale.lineItems[0].id, quantity: 1 }], reason: 'article défectueux', refundMethod: 'cash' } as any,
      'Alice',
    );

    expect(cn.origin).toBe('return');
    expect(cn.type).toBe('refund');
    expect(cn.refundMethod).toBe('cash');
    expect(cn.status).toBe('refunded');
    expect(cn.totalMinorUnits).toBe(500);
    expect(cn.remainingMinorUnits).toBe(0); // l'argent est SORTI du tiroir — rien de re-dépensable
    expect(cn.originalTicketNumber).toBe(sale.ticketNumber);

    // Empreinte de l'avoir auto-cohérente sur l'allowlist canonique
    // {code, storeId, originalSaleId, total, lines} — et maillon de la chaîne du magasin.
    const stored: any = await ds.getRepository(CreditNoteEntity).findOne({ where: { code: cn.code, storeId: STORE_ID }, relations: ['lines'] });
    const payload = JSON.stringify({
      code: stored.code,
      storeId: STORE_ID,
      originalSaleId: sale.id,
      total: 500,
      lines: stored.lines.map((l: any) => ({ p: l.productId, q: l.quantity, t: l.lineTotalMinorUnits })),
    });
    expect(stored.hashChainCurrent).toBe(sha256(stored.hashChainPrev + payload));
    if (stored.hashChainPrev !== GENESIS) {
      const all = await ds.getRepository(CreditNoteEntity).find({ where: { storeId: STORE_ID } });
      expect(all.some((r: any) => r.hashChainCurrent === stored.hashChainPrev)).toBe(true); // maillon, pas fork
    }
  });

  it('D1.2 — la vente d\'origine reste IMMUABLE (statut, hash, total inchangés)', async () => {
    const sale = await cashSale();
    const before: any = await ds.getRepository('sales').findOne({ where: { id: sale.id } });
    await returns.createReturn(
      STORE_ID, EMP_ID,
      { originalSaleId: sale.id, items: [{ lineItemId: sale.lineItems[0].id, quantity: 1 }], reason: 'retour', refundMethod: 'cash' } as any,
      'Alice',
    );
    const after: any = await ds.getRepository('sales').findOne({ where: { id: sale.id } });
    expect(after.status).toBe('completed');           // jamais 'voided' ni modifiée
    expect(after.hashChainCurrent).toBe(before.hashChainCurrent);
    expect(after.totalMinorUnits).toBe(before.totalMinorUnits);
  });

  it('D1.3 — le stock est restauré par le retour', async () => {
    const sale = await cashSale();
    const beforeStock = await stockOf();
    await returns.createReturn(
      STORE_ID, EMP_ID,
      { originalSaleId: sale.id, items: [{ lineItemId: sale.lineItems[0].id, quantity: 1 }], reason: 'retour', refundMethod: 'cash' } as any,
      'Alice',
    );
    expect(await stockOf()).toBe(beforeStock + 1);
  });

  it('D1.4 — FAIT ÉPINGLÉ (décision owner ouverte) : un retour cash n\'écrit AUCUN maillon fiscal_journal', async () => {
    // Contrairement au void (M4), createReturn ne touche pas fiscal_journal :
    // l'enregistrement opposable du retour est la chaîne credit_notes (D1.1).
    // Si un futur changement fait écrire un maillon journal ici (ou cesse de
    // chaîner l'avoir), ce test doit être MIS À JOUR avec la ratification
    // owner correspondante — jamais silencieusement (TECHNICAL_DEBT D1/D17).
    const journalBefore = await ds.getRepository(FiscalJournalEntity).count({ where: { storeId: STORE_ID } });
    const sale = await cashSale();
    await returns.createReturn(
      STORE_ID, EMP_ID,
      { originalSaleId: sale.id, items: [{ lineItemId: sale.lineItems[0].id, quantity: 1 }], reason: 'retour', refundMethod: 'cash' } as any,
      'Alice',
    );
    const journalAfter = await ds.getRepository(FiscalJournalEntity).count({ where: { storeId: STORE_ID } });
    expect(journalAfter).toBe(journalBefore); // aucun event journal émis par le retour cash (état actuel)
  });

  it('D1.5 — replay idempotent : même clé → même avoir, pas de second remboursement', async () => {
    const sale = await cashSale();
    const key = `ret-${uuidv4()}`.slice(0, 64);
    const dto = { originalSaleId: sale.id, items: [{ lineItemId: sale.lineItems[0].id, quantity: 1 }], reason: 'retour', refundMethod: 'cash' } as any;
    const first: any = await returns.createReturn(STORE_ID, EMP_ID, dto, 'Alice', key);
    const replay: any = await returns.createReturn(STORE_ID, EMP_ID, dto, 'Alice', key);
    expect(replay.code).toBe(first.code); // rejoué, pas dupliqué
    const count = await ds.getRepository(CreditNoteEntity).count({ where: { originalSaleId: sale.id } });
    expect(count).toBe(1); // UN seul avoir/remboursement pour cette vente
  });

  it('D1.6 — sur-retour refusé : on ne rembourse pas plus que le retournable', async () => {
    const sale = await cashSale();
    await returns.createReturn(
      STORE_ID, EMP_ID,
      { originalSaleId: sale.id, items: [{ lineItemId: sale.lineItems[0].id, quantity: 1 }], reason: 'retour', refundMethod: 'cash' } as any,
      'Alice',
    );
    await expect(returns.createReturn(
      STORE_ID, EMP_ID,
      { originalSaleId: sale.id, items: [{ lineItemId: sale.lineItems[0].id, quantity: 1 }], reason: 'retour bis', refundMethod: 'cash' } as any,
      'Alice',
    )).rejects.toThrow(/dépasse le retournable/);
  });
});
