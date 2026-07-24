/**
 * Bloc 22 (POS mission) — payment/stock error paths on createSale. The Bloc 0
 * audit flagged these as untested: a sale must NOT finalize on an incoherent
 * payment (total not covered, no payment) or insufficient stock — and on
 * rejection NOTHING is persisted (no sale row, stock untouched).
 */
import './helpers/env-setup';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { createPgMemDataSource, loadAllEntities } from './helpers/pgmem';
import { SalesModule } from '../src/modules/sales/sales.module';
import { CacheModule } from '../src/common/cache/cache.module';
import { MessagingModule } from '../src/common/messaging/messaging.module';
import { RealtimeModule } from '../src/common/realtime/realtime.module';
import { TimewinModule } from '../src/modules/timewin/timewin.module';
import { SalesService } from '../src/modules/sales/sales.service';
import { SaleEntity } from '../src/database/entities/sale.entity';
import { StoreEntity } from '../src/database/entities/store.entity';
import { ProductEntity } from '../src/database/entities/product.entity';
import { StockAnomalyEntity } from '../src/database/entities/stock-anomaly.entity';

describe('Bloc 22 — createSale payment & stock error paths', () => {
  let moduleRef: TestingModule;
  let ds: DataSource;
  let sales: SalesService;
  const STORE = uuidv4();
  const EMP = uuidv4();
  const snap = { employeeName: 'Alice', employeeRole: 'admin', maxDiscount: 100 };

  const saleCount = () => ds.getRepository(SaleEntity).count({ where: { storeId: STORE } });
  const stockOf = async () =>
    (await ds.getRepository(ProductEntity).findOneByOrFail({ ean: '3000000000001', storeId: STORE })).stockQuantity;

  beforeAll(async () => {
    const { dataSource } = createPgMemDataSource();
    moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        TypeOrmModule.forRootAsync({
          useFactory: () => ({ type: 'postgres', entities: loadAllEntities() as any, synchronize: true }),
          dataSourceFactory: async () => (dataSource.isInitialized ? dataSource : dataSource.initialize()),
        }),
        CacheModule,
        MessagingModule,
        RealtimeModule,
        TimewinModule,
        SalesModule,
      ],
    }).compile();
    ds = moduleRef.get(DataSource);
    sales = moduleRef.get(SalesService);

    await ds.getRepository(StoreEntity).save({ id: STORE, name: 'B43', storeCode: 'B43', currencyCode: 'EUR', isActive: true } as any);
    await ds.getRepository(ProductEntity).save({
      id: uuidv4(), storeId: STORE, ean: '3000000000001', name: 'Café', priceMinorUnits: 500, taxRate: 20,
      stockQuantity: 5, stockAlertThreshold: 2, stockCriticalThreshold: 1, isActive: true,
    } as any);
  });
  afterAll(async () => {
    await moduleRef?.close();
  });

  it('DECISIVE — payment under the total is rejected; no sale, stock untouched', async () => {
    const dto = { items: [{ ean: '3000000000001', quantity: 2 }], payments: [{ method: 'cash', amountMinorUnits: 500 }] }; // owe 1000
    await expect(sales.createSale(STORE, EMP, dto as any, snap)).rejects.toThrow(/< sale total/);
    expect(await saleCount()).toBe(0);
    expect(await stockOf()).toBe(5);
  });

  it('ADVERSE — a sale with no payment is rejected', async () => {
    const dto = { items: [{ ean: '3000000000001', quantity: 1 }], payments: [] };
    await expect(sales.createSale(STORE, EMP, dto as any, snap)).rejects.toThrow(/at least one payment/);
    expect(await saleCount()).toBe(0);
  });

  // RÈGLE MÉTIER (chantier 4) : le stock informatique ne bloque JAMAIS une
  // vente en caisse. Un stock insuffisant → vente validée, stock NÉGATIF (dette
  // de stock) + anomalie de stock (une par vente) à contrôler au BackOffice.
  it('RÈGLE MÉTIER — insufficient stock does NOT block: sale completes, stock goes negative, anomaly created', async () => {
    const dto = { items: [{ ean: '3000000000001', quantity: 99 }], payments: [{ method: 'cash', amountMinorUnits: 49500 }] };
    const sale: any = await sales.createSale(STORE, EMP, dto as any, snap);
    expect(sale.status).toBe('completed');
    expect(await saleCount()).toBe(1);
    expect(await stockOf()).toBe(5 - 99); // -94, jamais plafonné à zéro

    // Avertissement non bloquant renvoyé à la caisse
    const negAlert = (sale.stockAlerts ?? []).find((a: any) => a.level === 'negative_stock');
    expect(negAlert).toBeDefined();
    expect(negAlert.remainingStock).toBe(-94);
    expect(negAlert.message).toContain('Nouveau stock : -94');

    // Anomalie créée dans la MÊME transaction, statut À contrôler
    const anomalies = await ds.getRepository(StockAnomalyEntity).find({ where: { storeId: STORE } });
    expect(anomalies).toHaveLength(1);
    expect(anomalies[0].saleId).toBe(sale.id);
    expect(anomalies[0].status).toBe('a_controler');
    expect(anomalies[0].items).toHaveLength(1);
    expect(anomalies[0].items[0]).toMatchObject({
      ean: '3000000000001',
      stockBefore: 5,
      quantitySold: 99,
      stockAfter: -94,
      isPackComponent: false,
    });
  });

  it('a COHERENT sale then succeeds and decrements exactly (control) — negative stock keeps decrementing', async () => {
    const before = await stockOf(); // -94 après le test précédent
    const dto = { items: [{ ean: '3000000000001', quantity: 2 }], payments: [{ method: 'cash', amountMinorUnits: 1000 }] };
    const sale: any = await sales.createSale(STORE, EMP, dto as any, snap);
    expect(sale.status).toBe('completed');
    expect(await saleCount()).toBe(2);
    // Décrément exact, sans GREATEST(0, …) : -94 - 2 = -96
    expect(await stockOf()).toBe(before - 2);
  });
});
