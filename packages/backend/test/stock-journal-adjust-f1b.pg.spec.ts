/**
 * Journal de stock unifié — bloc F1b : `inventory_adjust` en shadow (delta SIGNÉ).
 * Gated sur TEST_DATABASE_URL. Vrai Postgres.
 *
 *   TEST_DATABASE_URL=postgresql://user@localhost:5432/caisse_f1b \
 *     npx jest --forceExit test/stock-journal-adjust-f1b.pg.spec.ts
 *
 * Prouve la CONVENTION RATIFIÉE (GO owner) : pour `inventory_adjust`, `quantity` = delta signé.
 *  - mode delta (−5)      → un mouvement quantity = −5 ;
 *  - mode absolu (15→30)  → un mouvement quantity = +15 (le delta, pas la valeur cible) ;
 *  - RÉCONCILIATION : le `gap` reste CONSTANT après ces ajustements — le journal suit désormais
 *    le scalaire. C'est l'INVERSE EXACT du 3ᵉ test de `stock-reconciliation-readonly.pg.spec.ts`,
 *    où l'adjust NON couvert faisait varier le gap (dette D22 : ce bloc en ferme la moitié) ;
 *  - flag OFF → aucun mouvement (comportement identique) ; delta nul → aucun mouvement ;
 *  - l'audit `stock_adjustment` reste écrit dans tous les cas.
 */
import './helpers/env-setup';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { loadAllEntities } from './helpers/pgmem';
import { StockModule } from '../src/modules/stock/stock.module';
import { CacheModule } from '../src/common/cache/cache.module';
import { MessagingModule } from '../src/common/messaging/messaging.module';
import { RealtimeModule } from '../src/common/realtime/realtime.module';
import { StockService } from '../src/modules/stock/stock.service';
import { StoreEntity } from '../src/database/entities/store.entity';
import { ProductEntity } from '../src/database/entities/product.entity';
import { StockMovementEntity } from '../src/database/entities/stock-movement.entity';
import { AuditEntryEntity } from '../src/database/entities/audit-entry.entity';

const TEST_DB = process.env.TEST_DATABASE_URL;
const d = TEST_DB ? describe : describe.skip;

/** Même instrument lecture seule que stock-reconciliation-readonly.pg.spec.ts. */
const RECONCILE_SQL = `
  SELECT p.stock_quantity::int AS scalar_stock,
         COALESCE(j.journal_sum, 0)::int AS journal_sum,
         (p.stock_quantity - COALESCE(j.journal_sum, 0))::int AS gap
  FROM products p
  LEFT JOIN (
    SELECT store_id, product_id,
      SUM(CASE movement_type
            WHEN 'sale' THEN -quantity
            WHEN 'pack_consumption' THEN -quantity
            WHEN 'return_customer' THEN quantity
            WHEN 'void' THEN quantity
            WHEN 'inventory_adjust' THEN quantity
            ELSE 0 END)::int AS journal_sum
    FROM stock_movements
    WHERE store_id IS NOT NULL
    GROUP BY store_id, product_id
  ) j ON j.store_id::text = p.store_id::text AND j.product_id::text = p.id::text
  WHERE p.store_id::text = $1 AND p.id::text = $2`;

d('F1b — inventory_adjust en shadow, delta signé (real Postgres)', () => {
  let moduleRef: TestingModule;
  let ds: DataSource;
  let stock: StockService;
  const STORE = uuidv4();
  const EMP = uuidv4();
  let productId: string;

  const movements = () =>
    ds.getRepository(StockMovementEntity).find({ where: { productId, movementType: 'inventory_adjust' }, order: { createdAt: 'ASC' } });
  const reconcile = async (): Promise<{ scalar_stock: number; journal_sum: number; gap: number }> =>
    (await ds.query(RECONCILE_SQL, [STORE, productId]))[0];

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        TypeOrmModule.forRoot({ type: 'postgres', url: TEST_DB, entities: loadAllEntities() as any, synchronize: true, extra: { max: 10 } }),
        CacheModule, MessagingModule, RealtimeModule, StockModule,
      ],
    }).compile();
    ds = moduleRef.get(DataSource);
    stock = moduleRef.get(StockService);
    await ds.getRepository(StoreEntity).save({ id: STORE, name: 'B47', storeCode: 'B47', currencyCode: 'EUR', isActive: true } as any);
    productId = uuidv4();
    await ds.getRepository(ProductEntity).save({
      id: productId, storeId: STORE, ean: '3400000000001', name: 'Sucre', priceMinorUnits: 200, taxRate: 20, stockQuantity: 20, isActive: true,
    } as any);
  });

  afterEach(() => { delete process.env.STOCK_JOURNAL_SHADOW; });
  afterAll(async () => { await moduleRef?.close(); });

  it('OFF : un ajustement n\'écrit aucun mouvement (comportement identique)', async () => {
    delete process.env.STOCK_JOURNAL_SHADOW;
    await stock.adjustStock(productId, -1, STORE, EMP, 'casse (flag off)', 'delta');
    expect(await movements()).toHaveLength(0);
    // remise à 20 pour la suite
    await stock.adjustStock(productId, 20, STORE, EMP, 'reset', 'absolute');
    expect(await movements()).toHaveLength(0);
  }, 60000);

  it('ON : mode delta (−5) → mouvement quantity = −5 (delta SIGNÉ) ; gap CONSTANT', async () => {
    process.env.STOCK_JOURNAL_SHADOW = 'true';
    const before = await reconcile();
    expect(before.scalar_stock).toBe(20);

    await stock.adjustStock(productId, -5, STORE, EMP, 'casse constatée', 'delta');

    const mv = await movements();
    expect(mv).toHaveLength(1);
    expect(mv[0].quantity).toBe(-5); // SIGNÉ — pas 5
    expect(mv[0].reason).toBe('casse constatée');
    expect(mv[0].storeId).toBe(STORE);

    const after = await reconcile();
    expect(after.scalar_stock).toBe(15);
    expect(after.journal_sum).toBe(-5);
    expect(after.gap).toBe(before.gap); // CONSTANT : le journal suit le scalaire
  }, 60000);

  it('ON : mode absolu (15→30) → mouvement quantity = +15 (le delta, pas la cible) ; gap CONSTANT', async () => {
    process.env.STOCK_JOURNAL_SHADOW = 'true';
    const before = await reconcile();
    expect(before.scalar_stock).toBe(15);

    await stock.adjustStock(productId, 30, STORE, EMP, 'régularisation inventaire', 'absolute');

    const mv = await movements();
    expect(mv).toHaveLength(2);
    expect(mv[1].quantity).toBe(15); // 30 − 15 = delta, PAS la valeur absolue 30

    const after = await reconcile();
    expect(after.scalar_stock).toBe(30);
    expect(after.journal_sum).toBe(10); // −5 + 15
    expect(after.gap).toBe(before.gap); // CONSTANT — inverse exact du 3e test de réconciliation
  }, 60000);

  it('ON : delta nul → aucun mouvement ; l\'audit reste écrit dans tous les cas', async () => {
    process.env.STOCK_JOURNAL_SHADOW = 'true';
    const n = (await movements()).length;
    await stock.adjustStock(productId, 30, STORE, EMP, 'no-op', 'absolute'); // déjà à 30
    expect(await movements()).toHaveLength(n); // rien de neuf

    const audits = await ds.getRepository(AuditEntryEntity).find({ where: { storeId: STORE, action: 'stock_adjustment' } });
    expect(audits.length).toBeGreaterThanOrEqual(1); // l'audit n'est pas impacté par F1b
  }, 60000);
});
