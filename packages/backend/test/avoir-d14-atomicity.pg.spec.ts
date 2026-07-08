/**
 * D1.4 (GO owner) — ATOMICITÉ TOTALE du retour sur un VRAI Postgres (gated
 * TEST_DATABASE_URL, exécuté par l'étape CI dédiée). pg-mem n'honore pas le
 * rollback d'un queryRunner dédié — cette preuve ne peut vivre qu'ici.
 *
 * Invariant owner : « En cas d'erreur, rollback complet. » Si un maillon du
 * scellement fiscal échoue en pleine transaction : pas d'avoir, pas de maillon
 * orphelin, stock intact, et la vente reste retournable ensuite.
 */
import './helpers/env-setup';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSource, EntitySubscriberInterface, InsertEvent } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';

import { loadAllEntities } from './helpers/pgmem';
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

const TEST_DB = process.env.TEST_DATABASE_URL;
const d = TEST_DB ? describe : describe.skip;
const EAN = '6100000000001';

d('D1.4 — atomicité totale du retour scellé (vrai Postgres)', () => {
  let moduleRef: TestingModule;
  let ds: DataSource;
  let sales: SalesService;
  let returns: ReturnsService;
  const STORE_ID = uuidv4();
  const EMP_ID = uuidv4();
  const SNAP = { employeeName: 'Alice', employeeRole: 'admin', maxDiscount: 100 };

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        TypeOrmModule.forRoot({ type: 'postgres', url: TEST_DB, entities: loadAllEntities() as any, synchronize: true }),
        CacheModule, MessagingModule, RealtimeModule, TimewinModule, SalesModule, ReturnsModule,
      ],
    }).compile();
    ds = moduleRef.get(DataSource);
    sales = moduleRef.get(SalesService);
    returns = moduleRef.get(ReturnsService);

    await ds.getRepository(StoreEntity).save({ id: STORE_ID, name: 'S', storeCode: 'SA', currencyCode: 'EUR', isActive: true } as any);
    await ds.getRepository(ProductEntity).save({
      id: uuidv4(), storeId: STORE_ID, ean: EAN, name: 'Article 10€',
      priceMinorUnits: 1000, taxRate: 20, stockQuantity: 100, stockAlertThreshold: 5, stockCriticalThreshold: 2, isActive: true,
    } as any);

    const saboteur: EntitySubscriberInterface<FiscalJournalEntity> = {
      listenTo: () => FiscalJournalEntity,
      beforeInsert(event: InsertEvent<FiscalJournalEntity>) {
        if (event.entity?.payload?.includes('FORCE_FAIL')) {
          throw new Error('sabotage scellement (test atomicité)');
        }
      },
    };
    ds.subscribers.push(saboteur);
  });

  afterAll(async () => { await moduleRef?.close(); });

  const stockOf = async () => (await ds.getRepository(ProductEntity).findOne({ where: { storeId: STORE_ID, ean: EAN } }))!.stockQuantity;

  it('un maillon journal qui échoue annule TOUT : pas d\'avoir, pas de maillon, stock intact, vente toujours retournable', async () => {
    const sale: any = await sales.createSale(
      STORE_ID, EMP_ID,
      { items: [{ ean: EAN, quantity: 1 }], payments: [{ method: 'cash', amountMinorUnits: 1000 }] } as any,
      SNAP,
    );
    const stockBefore = await stockOf();
    const cnBefore = await ds.getRepository(CreditNoteEntity).count({ where: { storeId: STORE_ID } });
    const jBefore = await ds.getRepository(FiscalJournalEntity).count({ where: { storeId: STORE_ID } });

    // Le motif atterrit dans le payload du 2e maillon (credit_note_issued) — le
    // saboteur jette APRÈS le 1er maillon, l'avoir et la restauration stock :
    // seule l'atomicité de la transaction peut tout remettre.
    await expect(returns.createReturn(
      STORE_ID, EMP_ID,
      { originalSaleId: sale.id, items: [{ lineItemId: sale.lineItems[0].id, quantity: 1 }], reason: 'FORCE_FAIL sabotage', refundMethod: 'cash' } as any,
      'Alice',
    )).rejects.toThrow(/sabotage/);

    expect(await ds.getRepository(CreditNoteEntity).count({ where: { storeId: STORE_ID } })).toBe(cnBefore);
    expect(await ds.getRepository(FiscalJournalEntity).count({ where: { storeId: STORE_ID } })).toBe(jBefore);
    expect(await stockOf()).toBe(stockBefore);

    // La vente d'origine est intacte : le retour repasse ensuite normalement,
    // avec ses 4 maillons scellés.
    const retry: any = await returns.createReturn(
      STORE_ID, EMP_ID,
      { originalSaleId: sale.id, items: [{ lineItemId: sale.lineItems[0].id, quantity: 1 }], reason: 'retour après sabotage', refundMethod: 'cash' } as any,
      'Alice',
    );
    expect(retry.id).toBeTruthy();
    const mine = await ds.getRepository(FiscalJournalEntity).find({ where: { storeId: STORE_ID, refId: retry.id } });
    expect(mine.map((r) => r.eventType).sort()).toEqual(
      ['cash_refund_recorded', 'credit_note_issued', 'sale_original_referenced', 'stock_restored'],
    );
    expect(await stockOf()).toBe(stockBefore + 1); // stock restauré par le VRAI retour
  });
});
