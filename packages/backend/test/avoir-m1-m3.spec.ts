/**
 * Fiscal fixes M1 + M3 against a real in-memory Postgres (pg-mem).
 *
 * M1 — an avoir (store_credit) can never be redeemed beyond the residual due.
 * M3 — voiding a sale paid (partly) by an avoir restores the avoir balance,
 *      exactly once, without mutating the original sale.
 */
import './helpers/env-setup';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
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
import { CreditNoteEntity } from '../src/database/entities/credit-note.entity';

describe('Fiscal — M1 (avoir cap) + M3 (avoir restore on void)', () => {
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
      id: uuidv4(), storeId: STORE_ID, ean: '5000000000001', name: 'Article 5€',
      priceMinorUnits: 500, taxRate: 20, stockQuantity: 1000, stockAlertThreshold: 5, stockCriticalThreshold: 2, isActive: true,
    } as any);
  });

  afterAll(async () => { await moduleRef?.close(); });

  async function mintAvoir(amount: number): Promise<string> {
    const cn: any = await returns.issueGiftCard(STORE_ID, EMP_ID, { amountMinorUnits: amount }, 'Alice');
    return cn.code;
  }
  const avoir = (code: string) => ds.getRepository(CreditNoteEntity).findOne({ where: { code, storeId: STORE_ID } }) as Promise<any>;
  // pg-mem mis-types GREATEST(0, stock - $1) → stock collapses to 0 after one sale.
  // Replenish stock (plain SET) before each createSale so the pre-tx stock check
  // never masks the fiscal logic under test. (Real Postgres decrements exactly.)
  const freshStock = () => ds.getRepository(ProductEntity).update({ storeId: STORE_ID }, { stockQuantity: 1000 });

  /* ── M1 ─────────────────────────────────────────────────────────────────── */

  it('M1 — refuse un avoir supérieur au total (pas de sur-débit)', async () => {
    const code = await mintAvoir(10000); // 100€ avoir
    const dto = { items: [{ ean: '5000000000001', quantity: 1 }], payments: [{ method: 'store_credit', amountMinorUnits: 10000, creditNoteCode: code }] };
    await freshStock();
    await expect(sales.createSale(STORE_ID, EMP_ID, dto as any, SNAP)).rejects.toThrow(/dépasse le reste dû/);
    expect((await avoir(code)).remainingMinorUnits).toBe(10000); // intact
  });

  it('M1 — paiement mixte avoir+cash : avoir capé au reste dû (OK puis refus si excès)', async () => {
    const code = await mintAvoir(10000);
    // total 1000 (2 articles), cash 600 → reste dû 400 → avoir 400 OK
    const ok = { items: [{ ean: '5000000000001', quantity: 2 }], payments: [
      { method: 'cash', amountMinorUnits: 600 }, { method: 'store_credit', amountMinorUnits: 400, creditNoteCode: code },
    ] };
    await freshStock();
    const sale: any = await sales.createSale(STORE_ID, EMP_ID, ok as any, SNAP);
    expect(sale.id).toBeTruthy();
    expect((await avoir(code)).remainingMinorUnits).toBe(9600); // débité de 400 seulement

    // même config mais avoir 500 (> reste dû 400) → refus
    const ko = { items: [{ ean: '5000000000001', quantity: 2 }], payments: [
      { method: 'cash', amountMinorUnits: 600 }, { method: 'store_credit', amountMinorUnits: 500, creditNoteCode: code },
    ] };
    await freshStock();
    await expect(sales.createSale(STORE_ID, EMP_ID, ko as any, SNAP)).rejects.toThrow(/dépasse le reste dû/);
    expect((await avoir(code)).remainingMinorUnits).toBe(9600); // inchangé après le refus
  });

  /* ── M3 ─────────────────────────────────────────────────────────────────── */

  it('M3 — void d’une vente payée par avoir → solde restauré, ticket immuable', async () => {
    const code = await mintAvoir(500);
    const dto = { items: [{ ean: '5000000000001', quantity: 1 }], payments: [{ method: 'store_credit', amountMinorUnits: 500, creditNoteCode: code }] };
    await freshStock();
    const sale: any = await sales.createSale(STORE_ID, EMP_ID, dto as any, SNAP);
    expect((await avoir(code)).remainingMinorUnits).toBe(0); // consommé
    expect((await avoir(code)).status).toBe('redeemed');

    const before: any = await ds.getRepository('sales').findOne({ where: { id: sale.id } });
    const voided: any = await sales.voidSale(sale.id, EMP_ID, STORE_ID, 'admin');

    expect(voided.status).toBe('voided');
    // avoir restauré
    const cn = await avoir(code);
    expect(cn.remainingMinorUnits).toBe(500);
    expect(cn.status).toBe('active');
    // ticket d’origine immuable (hash + total inchangés)
    expect(voided.hashChainCurrent).toBe(before.hashChainCurrent);
    expect(voided.totalMinorUnits).toBe(before.totalMinorUnits);
  });

  it('M3 — double void ne restaure pas deux fois', async () => {
    const code = await mintAvoir(500);
    const dto = { items: [{ ean: '5000000000001', quantity: 1 }], payments: [{ method: 'store_credit', amountMinorUnits: 500, creditNoteCode: code }] };
    await freshStock();
    const sale: any = await sales.createSale(STORE_ID, EMP_ID, dto as any, SNAP);
    await sales.voidSale(sale.id, EMP_ID, STORE_ID, 'admin');
    await expect(sales.voidSale(sale.id, EMP_ID, STORE_ID, 'admin')).rejects.toThrow(/already voided/i);
    expect((await avoir(code)).remainingMinorUnits).toBe(500); // restauré UNE fois, pas 1000
  });

  it('M3 — vente mixte avoir+cash : seule la part avoir est restaurée', async () => {
    const code = await mintAvoir(300);
    const dto = { items: [{ ean: '5000000000001', quantity: 1 }], payments: [
      { method: 'cash', amountMinorUnits: 200 }, { method: 'store_credit', amountMinorUnits: 300, creditNoteCode: code },
    ] };
    await freshStock();
    const sale: any = await sales.createSale(STORE_ID, EMP_ID, dto as any, SNAP);
    expect((await avoir(code)).remainingMinorUnits).toBe(0);
    await sales.voidSale(sale.id, EMP_ID, STORE_ID, 'admin');
    expect((await avoir(code)).remainingMinorUnits).toBe(300); // part avoir restaurée
  });
});
