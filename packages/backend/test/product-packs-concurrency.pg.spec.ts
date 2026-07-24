/**
 * GO Product Packs — preuves VRAI Postgres (gated TEST_DATABASE_URL, étape CI
 * dédiée « Backend PG specs ») :
 *
 *  1. deltas de stock EXACTS à la vente et au retour (pg-mem évalue mal
 *     l'arithmétique paramétrée `stock - $1` — voir product-packs.spec.ts) ;
 *  2. CONCURRENCE sur le stock d'un composant (chantier 4 — stock négatif) :
 *     N ventes simultanées aboutissent TOUTES ; le stock du composant devient
 *     négatif SANS perte de mouvement (décrément relatif atomique), et chaque
 *     vente passée sous zéro porte son anomalie de stock (isPackComponent).
 */
import './helpers/env-setup';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';

import { loadAllEntities } from './helpers/pgmem';
import { SalesModule } from '../src/modules/sales/sales.module';
import { ReturnsModule } from '../src/modules/returns/returns.module';
import { ProductsModule } from '../src/modules/products/products.module';
import { CacheModule } from '../src/common/cache/cache.module';
import { MessagingModule } from '../src/common/messaging/messaging.module';
import { RealtimeModule } from '../src/common/realtime/realtime.module';
import { TimewinModule } from '../src/modules/timewin/timewin.module';
import { SalesService } from '../src/modules/sales/sales.service';
import { ReturnsService } from '../src/modules/returns/returns.service';
import { ProductsService } from '../src/modules/products/products.service';
import { StoreEntity } from '../src/database/entities/store.entity';
import { ProductEntity } from '../src/database/entities/product.entity';
import { SaleComponentMovementEntity } from '../src/database/entities/sale-component-movement.entity';
import { StockAnomalyEntity } from '../src/database/entities/stock-anomaly.entity';

const TEST_DB = process.env.TEST_DATABASE_URL;
const d = TEST_DB ? describe : describe.skip;

jest.setTimeout(90_000);

d('Product Packs — deltas exacts, concurrence composant, atomicité (vrai Postgres)', () => {
  let moduleRef: TestingModule;
  let ds: DataSource;
  let sales: SalesService;
  let returns: ReturnsService;
  let products: ProductsService;
  const STORE_ID = uuidv4();
  const EMP_ID = uuidv4();
  const SNAP = { employeeName: 'Alice', employeeRole: 'admin', maxDiscount: 100 };

  const PACK_ID = uuidv4();
  const COMP1_ID = uuidv4();
  const COMP2_ID = uuidv4();
  const EAN_PACK = '7100000000017';

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        TypeOrmModule.forRoot({
          type: 'postgres', url: TEST_DB, entities: loadAllEntities() as any,
          synchronize: true,
          // 10+ ventes concurrentes = 10 queryRunners dédiés simultanés — le
          // pool par défaut (10) s'affame (leçon de sales-stock-concurrency).
          extra: { max: 30 },
        }),
        CacheModule, MessagingModule, RealtimeModule, TimewinModule,
        ProductsModule, SalesModule, ReturnsModule,
      ],
    }).compile();
    ds = moduleRef.get(DataSource);
    sales = moduleRef.get(SalesService);
    returns = moduleRef.get(ReturnsService);
    products = moduleRef.get(ProductsService);

    await ds.getRepository(StoreEntity).save({ id: STORE_ID, name: 'S', storeCode: 'PKPG', currencyCode: 'EUR', isActive: true } as any);
    const mk = (id: string, ean: string, name: string, stock: number) => ({
      id, storeId: STORE_ID, ean, name, priceMinorUnits: 1999, taxRate: 20,
      stockQuantity: stock, stockAlertThreshold: 5, stockCriticalThreshold: 2, isActive: true,
    });
    await ds.getRepository(ProductEntity).save([
      mk(PACK_ID, EAN_PACK, 'Humidificateur', 100),
      mk(COMP1_ID, '7100000000024', 'Cristalline 50cl', 100),
      mk(COMP2_ID, '7100000000031', 'Câble USB', 100),
    ] as any);
    await products.addComponent(PACK_ID, STORE_ID, { componentProductId: COMP1_ID, quantityPerParent: 1 });
    await products.addComponent(PACK_ID, STORE_ID, { componentProductId: COMP2_ID, quantityPerParent: 2 });
  });

  afterAll(async () => { await moduleRef?.close(); });

  const stockOf = async (id: string) =>
    (await ds.getRepository(ProductEntity).findOne({ where: { id } }))!.stockQuantity;
  const setStock = (id: string, q: number) =>
    ds.getRepository(ProductEntity).update({ id }, { stockQuantity: q });

  const sellPack = (qty = 1) =>
    sales.createSale(
      STORE_ID, EMP_ID,
      { items: [{ ean: EAN_PACK, quantity: qty }], payments: [{ method: 'cash', amountMinorUnits: 1999 * qty }] } as any,
      SNAP,
    ) as any;

  it('deltas EXACTS — vente ×2 : parent -2, composants -2/-4 ; retour ×1 : +1/+1/+2', async () => {
    await setStock(PACK_ID, 50); await setStock(COMP1_ID, 50); await setStock(COMP2_ID, 50);
    const sale = await sellPack(2);
    expect(await stockOf(PACK_ID)).toBe(48);
    expect(await stockOf(COMP1_ID)).toBe(48);
    expect(await stockOf(COMP2_ID)).toBe(46);

    await returns.createReturn(
      STORE_ID, EMP_ID,
      { originalSaleId: sale.id, items: [{ lineItemId: sale.lineItems[0].id, quantity: 1 }], reason: 'retour partiel', refundMethod: 'store_credit' } as any,
      'Alice',
    );
    expect(await stockOf(PACK_ID)).toBe(49);
    expect(await stockOf(COMP1_ID)).toBe(49);
    expect(await stockOf(COMP2_ID)).toBe(48);
  });

  it('CONCURRENCE composant (chantier 4) — 10 ventes simultanées, Cristalline=5 : TOUTES passent, composant à -5 sans perte de mouvement, 5 anomalies', async () => {
    await setStock(PACK_ID, 100);
    await setStock(COMP1_ID, 5);   // goulot : 1 par pack → dette de -5 attendue
    await setStock(COMP2_ID, 100);
    const salesBefore = await ds.getRepository('sales').count({ where: { storeId: STORE_ID } });
    const movesBefore = await ds.getRepository(SaleComponentMovementEntity).count({ where: { storeId: STORE_ID } });

    const results = await Promise.allSettled(Array.from({ length: 10 }, () => sellPack(1)));
    const ok = results.filter((r) => r.status === 'fulfilled');

    // RÈGLE MÉTIER : le stock ne bloque JAMAIS la vente — les 10 aboutissent.
    expect(ok).toHaveLength(10);
    // Décrément relatif atomique : 5 - 10 = -5, aucun mouvement perdu.
    expect(await stockOf(COMP1_ID)).toBe(-5);
    expect(await stockOf(PACK_ID)).toBe(90);
    expect(await stockOf(COMP2_ID)).toBe(80); // 2 × 10 ventes

    // 10 ventes réelles, 2 mouvements composant par vente.
    expect(await ds.getRepository('sales').count({ where: { storeId: STORE_ID } })).toBe(salesBefore + 10);
    const movesAfter = await ds.getRepository(SaleComponentMovementEntity).count({ where: { storeId: STORE_ID } });
    expect(movesAfter).toBe(movesBefore + 20);

    // Les 5 ventes descendues sous zéro portent chacune une anomalie ciblant
    // le composant (isPackComponent), stockAfter -1..-5.
    const anomalies = (await ds.getRepository(StockAnomalyEntity).find({ where: { storeId: STORE_ID } }))
      .filter((a) => a.items.some((i) => i.productId === COMP1_ID));
    expect(anomalies).toHaveLength(5);
    for (const a of anomalies) {
      const item = a.items.find((i) => i.productId === COMP1_ID)!;
      expect(item.isPackComponent).toBe(true);
      expect(item.stockAfter).toBeLessThan(0);
    }
    const afters = anomalies.map((a) => a.items.find((i) => i.productId === COMP1_ID)!.stockAfter).sort((x, y) => x - y);
    expect(afters).toEqual([-5, -4, -3, -2, -1]);
  });
});
