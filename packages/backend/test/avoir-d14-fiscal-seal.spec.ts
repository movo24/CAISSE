/**
 * D1.4 (GO owner) — invariants complémentaires du scellement fiscal des retours :
 * store_credit ne scelle PAS de sortie cash, avoir sans vente = impossible,
 * et surtout : ATOMICITÉ TOTALE — si un maillon du journal échoue en pleine
 * transaction, TOUT est annulé (pas d'avoir, pas de maillons, stock intact).
 */
import './helpers/env-setup';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSource, EntitySubscriberInterface, InsertEvent } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';

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

const EAN = '6000000000001';

describe('D1.4 — scellement fiscal des retours : cash-only, intégrité, atomicité', () => {
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

    await ds.getRepository(StoreEntity).save({ id: STORE_ID, name: 'S', storeCode: 'S9', currencyCode: 'EUR', isActive: true } as any);
    await ds.getRepository(ProductEntity).save({
      id: uuidv4(), storeId: STORE_ID, ean: EAN, name: 'Article 10€',
      priceMinorUnits: 1000, taxRate: 20, stockQuantity: 1000, stockAlertThreshold: 5, stockCriticalThreshold: 2, isActive: true,
    } as any);

    // Saboteur de test : fait échouer l'insertion d'un maillon journal dont le
    // payload contient FORCE_FAIL — prouve le rollback TOTAL de la transaction.
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

  const freshStock = () => ds.getRepository(ProductEntity).update({ storeId: STORE_ID }, { stockQuantity: 1000 });
  const stockOf = async () => (await ds.getRepository(ProductEntity).findOne({ where: { storeId: STORE_ID, ean: EAN } }))!.stockQuantity;

  async function cashSale(): Promise<any> {
    await freshStock();
    const dto = { items: [{ ean: EAN, quantity: 1 }], payments: [{ method: 'cash', amountMinorUnits: 1000 }] };
    return sales.createSale(STORE_ID, EMP_ID, dto as any, SNAP);
  }

  it('retour store_credit → 3 maillons (référence, émission, stock) et AUCUNE sortie cash', async () => {
    const sale = await cashSale();
    const cn: any = await returns.createReturn(
      STORE_ID, EMP_ID,
      { originalSaleId: sale.id, items: [{ lineItemId: sale.lineItems[0].id, quantity: 1 }], reason: 'avoir crédit', refundMethod: 'store_credit' } as any,
      'Alice',
    );
    const mine = await ds.getRepository(FiscalJournalEntity).find({ where: { storeId: STORE_ID, refId: cn.id }, order: { createdAt: 'ASC' } });
    expect(mine.map((r) => r.eventType)).toEqual(['sale_original_referenced', 'credit_note_issued', 'stock_restored']);
    expect(mine.some((r) => r.eventType === 'cash_refund_recorded')).toBe(false); // pas de cash sorti
    // store_credit : pas d'approbation cash requise
    const stored: any = await ds.getRepository(CreditNoteEntity).findOne({ where: { id: cn.id } });
    expect(stored.approvedByEmployeeId).toBeNull();
    expect(stored.sequentialNumber).toBeGreaterThan(0);
  });

  it('avoir sans vente originale → impossible (404, rien n\'est créé)', async () => {
    const before = await ds.getRepository(CreditNoteEntity).count({ where: { storeId: STORE_ID } });
    await expect(returns.createReturn(
      STORE_ID, EMP_ID,
      { originalSaleId: uuidv4(), items: [{ lineItemId: uuidv4(), quantity: 1 }], reason: 'fantôme', refundMethod: 'cash' } as any,
      'Alice',
    )).rejects.toThrow(/introuvable/);
    expect(await ds.getRepository(CreditNoteEntity).count({ where: { storeId: STORE_ID } })).toBe(before);
  });

  it('le sabotage d\'un maillon fait bien échouer le retour (le rollback COMPLET est prouvé sur vrai Postgres)', async () => {
    // pg-mem n'honore pas fiablement le rollback d'une transaction portée par un
    // queryRunner dédié (l'avoir « survit » au rollback) — la preuve d'atomicité
    // totale vit donc dans avoir-d14-atomicity.pg.spec.ts, exécutée en CI sur un
    // vrai Postgres (bloc TEST_DATABASE_URL). Ici on épingle seulement que le
    // sabotage remonte bien en erreur (pas de succès silencieux).
    const sale = await cashSale();
    await expect(returns.createReturn(
      STORE_ID, EMP_ID,
      { originalSaleId: sale.id, items: [{ lineItemId: sale.lineItems[0].id, quantity: 1 }], reason: 'FORCE_FAIL sabotage', refundMethod: 'cash' } as any,
      'Alice',
    )).rejects.toThrow(/sabotage/);
  });
});
