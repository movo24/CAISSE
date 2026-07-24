/**
 * P0 financier 2026-07-24 — le montant APPLIQUÉ ne dépasse jamais le total.
 * Reproduction owner : ticket 6 €, cash 3 € puis un 2ᵉ tender de 300 € → doit
 * être refusé (jamais 303 € encaissés ni 297 € de « monnaie » silencieuse). Les
 * espèces reçues / la monnaie sont des champs DISTINCTS (`cashReceivedMinorUnits`).
 * Ce garde est la DERNIÈRE ligne de défense : même un payload forgé est refusé.
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

describe('P0 — garde sur-paiement (montant appliqué ≤ total)', () => {
  let moduleRef: TestingModule;
  let ds: DataSource;
  let sales: SalesService;
  const STORE = uuidv4();
  const EMP = uuidv4();
  const snap = { employeeName: 'Alice', employeeRole: 'admin', maxDiscount: 100 };
  const EAN = '3000000000009';

  const saleCount = () => ds.getRepository(SaleEntity).count({ where: { storeId: STORE } });
  const freshStock = () =>
    ds.getRepository(ProductEntity).update({ ean: EAN, storeId: STORE }, { stockQuantity: 100 });

  beforeAll(async () => {
    const { dataSource } = createPgMemDataSource();
    moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        TypeOrmModule.forRootAsync({
          useFactory: () => ({ type: 'postgres', entities: loadAllEntities() as any, synchronize: true }),
          dataSourceFactory: async () => (dataSource.isInitialized ? dataSource : dataSource.initialize()),
        }),
        CacheModule, MessagingModule, RealtimeModule, TimewinModule, SalesModule,
      ],
    }).compile();
    ds = moduleRef.get(DataSource);
    sales = moduleRef.get(SalesService);
    await ds.getRepository(StoreEntity).save({ id: STORE, name: 'B', storeCode: 'BOP', currencyCode: 'EUR', isActive: true } as any);
    // Article à 3,00 € → 2 articles = 6,00 € (cas owner).
    await ds.getRepository(ProductEntity).save({
      id: uuidv4(), storeId: STORE, ean: EAN, name: 'Test 3€', priceMinorUnits: 300, taxRate: 20,
      stockQuantity: 100, stockAlertThreshold: 2, stockCriticalThreshold: 1, isActive: true,
    } as any);
  });
  afterAll(async () => { await moduleRef?.close(); });

  it('cas owner 1 : ticket 6€, cash 3€ + cash 3€ (appliqués) → ACCEPTÉ, net = 6€', async () => {
    await freshStock();
    const dto = { items: [{ ean: EAN, quantity: 2 }], payments: [
      { method: 'cash', amountMinorUnits: 300 }, { method: 'cash', amountMinorUnits: 300 },
    ] };
    const sale: any = await sales.createSale(STORE, EMP, dto as any, snap);
    expect(sale.status).toBe('completed');
    expect(sale.totalMinorUnits).toBe(600);
  });

  it('cas owner 2 : ticket 6€, cash 3€ appliqué + 2ᵉ tender 300€ APPLIQUÉ → REFUSÉ, aucune vente', async () => {
    await freshStock();
    const before = await saleCount();
    const dto = { items: [{ ean: EAN, quantity: 2 }], payments: [
      { method: 'cash', amountMinorUnits: 300 }, { method: 'cash', amountMinorUnits: 30000 },
    ] };
    await expect(sales.createSale(STORE, EMP, dto as any, snap)).rejects.toThrow(/[Ss]ur-?paiement|dépasse le total/);
    expect(await saleCount()).toBe(before); // rien persisté
  });

  it('cas owner 3 : cash appliqué 6€ + espèces reçues 10€ (monnaie 4€) → ACCEPTÉ (reçu séparé, appliqué = total)', async () => {
    await freshStock();
    const dto = { items: [{ ean: EAN, quantity: 2 }], payments: [
      { method: 'cash', amountMinorUnits: 600, cashReceivedMinorUnits: 1000 },
    ] };
    const sale: any = await sales.createSale(STORE, EMP, dto as any, snap);
    expect(sale.status).toBe('completed');
    expect(sale.totalMinorUnits).toBe(600); // net imputé = 6€, la monnaie n'y entre pas
  });

  it('cas owner 4 : carte APPLIQUÉE > total → REFUSÉ', async () => {
    await freshStock();
    const dto = { items: [{ ean: EAN, quantity: 2 }], payments: [{ method: 'card', amountMinorUnits: 30000 }] };
    await expect(sales.createSale(STORE, EMP, dto as any, snap)).rejects.toThrow(/[Ss]ur-?paiement|dépasse le total/);
  });

  it('espèces reçues < appliqué → REFUSÉ (incohérent)', async () => {
    await freshStock();
    const dto = { items: [{ ean: EAN, quantity: 2 }], payments: [
      { method: 'cash', amountMinorUnits: 600, cashReceivedMinorUnits: 500 },
    ] };
    await expect(sales.createSale(STORE, EMP, dto as any, snap)).rejects.toThrow(/reçues.*<.*appliqué/i);
  });

  it('« reçu » > appliqué sur CARTE (dépassement/monnaie interdit hors espèces) → REFUSÉ', async () => {
    await freshStock();
    const dto = { items: [{ ean: EAN, quantity: 2 }], payments: [
      { method: 'card', amountMinorUnits: 600, cashReceivedMinorUnits: 1000 },
    ] };
    await expect(sales.createSale(STORE, EMP, dto as any, snap)).rejects.toThrow(/dépassement.*interdit|monnaie/i);
  });
});
