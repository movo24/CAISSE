/**
 * Bloc 22 (POS mission) + chantier 4 (stock négatif) — CONCURRENT stock
 * decrement on a REAL Postgres (gated on TEST_DATABASE_URL; skipped otherwise).
 *
 * RÈGLE MÉTIER (chantier 4) : le stock informatique ne bloque JAMAIS une vente
 * en caisse. Sous concurrence, la préoccupation n'est plus la sur-vente (le
 * négatif est un état légitime) mais la PERTE DE MOUVEMENT : N ventes
 * concurrentes doivent TOUTES aboutir et le stock final doit refléter
 * exactement N décréments (l'UPDATE relatif est atomique). Chaque vente dont le
 * stock résultant est négatif crée SA propre anomalie de stock.
 *
 *   TEST_DATABASE_URL=postgresql://user@localhost:5432/caisse_concurrency \
 *     npx jest --forceExit test/sales-stock-concurrency.pg.spec.ts
 */
import './helpers/env-setup';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { loadAllEntities } from './helpers/pgmem';
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

const TEST_DB = process.env.TEST_DATABASE_URL;
const d = TEST_DB ? describe : describe.skip;

d('Concurrent stock decrement (real Postgres) — negative stock allowed, no lost movement', () => {
  let moduleRef: TestingModule;
  let ds: DataSource;
  let sales: SalesService;
  const STORE = uuidv4();
  const EMP = uuidv4();
  const EAN = '3000000000001';
  const EAN_ZERO = '3000000000002';
  let productZeroId: string;
  const snap = { employeeName: 'Alice', employeeRole: 'admin', maxDiscount: 100 };

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        // Pool 30 : 10 createSale concurrents tiennent chacun un queryRunner dédié
        // PENDANT que le verrou store (FOR UPDATE) les sérialise — avec le pool par
        // défaut (10), les requêtes annexes attendent une connexion libre et le
        // test s'affame (timeout). Le harnais dimensionne son pool ; la prod garde le sien.
        TypeOrmModule.forRoot({ type: 'postgres', url: TEST_DB, entities: loadAllEntities() as any, synchronize: true, extra: { max: 30 } }),
        CacheModule, MessagingModule, RealtimeModule, TimewinModule, SalesModule,
      ],
    }).compile();
    ds = moduleRef.get(DataSource);
    sales = moduleRef.get(SalesService);
    await ds.getRepository(StoreEntity).save({ id: STORE, name: 'B43', storeCode: 'B43', currencyCode: 'EUR', isActive: true } as any);
    await ds.getRepository(ProductEntity).save({
      id: uuidv4(), storeId: STORE, ean: EAN, name: 'Café', priceMinorUnits: 500, taxRate: 20,
      stockQuantity: 5, stockAlertThreshold: 2, stockCriticalThreshold: 1, isActive: true,
    } as any);
    productZeroId = uuidv4();
    await ds.getRepository(ProductEntity).save({
      id: productZeroId, storeId: STORE, ean: EAN_ZERO, name: 'Fraise', priceMinorUnits: 500, taxRate: 20,
      stockQuantity: 0, stockAlertThreshold: 2, stockCriticalThreshold: 1, isActive: true,
    } as any);
  });
  afterAll(async () => {
    await moduleRef?.close();
  });

  const oneSale = (ean: string, key: string) =>
    sales.createSale(
      STORE, EMP,
      { items: [{ ean, quantity: 1 }], payments: [{ method: 'cash', amountMinorUnits: 500 }] } as any,
      snap,
      key,
    ).then(() => 'ok' as const).catch(() => 'rejected' as const);

  it('DECISIVE — 10 concurrent 1-unit sales on stock=5: ALL succeed, stock lands at exactly -5 (no lost movement)', async () => {
    jest.setTimeout(90_000); // 10 ventes sérialisées par le verrou store sur vrai PG
    const results = await Promise.all(Array.from({ length: 10 }, (_, i) => oneSale(EAN, `conc-${i}`)));
    const ok = results.filter((r) => r === 'ok').length;

    const stock = (await ds.getRepository(ProductEntity).findOneByOrFail({ ean: EAN, storeId: STORE })).stockQuantity;
    expect(ok).toBe(10); // plus AUCUN rejet pour stock insuffisant
    expect(stock).toBe(-5); // 5 - 10 : chaque décrément compté exactement une fois
    expect(await ds.getRepository(SaleEntity).count({ where: { storeId: STORE, status: 'completed' } })).toBe(10);

    // Les 5 ventes descendues sous zéro (à -1, -2, -3, -4, -5) portent chacune
    // leur anomalie ; les 5 restées à 4..0 n'en portent pas.
    const anomalies = await ds.getRepository(StockAnomalyEntity).find({ where: { storeId: STORE } });
    expect(anomalies).toHaveLength(5);
    const afters = anomalies.map((a) => a.items[0].stockAfter).sort((x, y) => x - y);
    expect(afters).toEqual([-5, -4, -3, -2, -1]);
  });

  it('RÈGLE MÉTIER — 2 concurrent 1-unit sales on stock=0 → -2, both complete, one anomaly each', async () => {
    jest.setTimeout(60_000);
    const results = await Promise.all([
      oneSale(EAN_ZERO, `zero-a-${uuidv4()}`),
      oneSale(EAN_ZERO, `zero-b-${uuidv4()}`),
    ]);
    expect(results).toEqual(['ok', 'ok']);

    const stock = (await ds.getRepository(ProductEntity).findOneByOrFail({ ean: EAN_ZERO, storeId: STORE })).stockQuantity;
    expect(stock).toBe(-2); // aucun mouvement perdu

    const anomalies = (await ds.getRepository(StockAnomalyEntity).find({ where: { storeId: STORE } }))
      .filter((a) => a.items.some((i) => i.productId === productZeroId));
    expect(anomalies).toHaveLength(2);
    const afters = anomalies.map((a) => a.items[0].stockAfter).sort((x, y) => x - y);
    expect(afters).toEqual([-2, -1]);
  });
});
