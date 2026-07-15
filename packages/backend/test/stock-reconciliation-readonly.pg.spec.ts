/**
 * Outil d'observation F3 — RÉCONCILIATION scalaire vs SUM(mouvements), LECTURE SEULE.
 * Gated sur TEST_DATABASE_URL. Instrument de mesure du double-run (à posséder AVANT
 * toute activation du flag STOCK_JOURNAL_SHADOW hors test).
 *
 *   TEST_DATABASE_URL=postgresql://user@localhost:5432/caisse_recon \
 *     npx jest --forceExit test/stock-reconciliation-readonly.pg.spec.ts
 *
 * Le cœur est la requête RECONCILE_SQL : un SELECT PUR (aucune écriture, aucun DDL,
 * aucun chemin fiscal) qui renvoie, par (magasin, produit) :
 *   scalar_stock  = products.stock_quantity (source lue par la caisse)
 *   journal_sum   = somme SIGNÉE des mouvements de liaison vente (store_id non nul) :
 *                   sale/pack_consumption = −qty ; return_customer/void = +qty ;
 *                   inventory_adjust = +qty (delta signé, cf. F1b)
 *   gap           = scalar_stock − journal_sum
 *
 * PROPRIÉTÉ CLÉ (prouvée ici) : tant que seuls des chemins COUVERTS tournent
 * (vente, retour), `gap` reste CONSTANT (= le solde d'ouverture implicite). Toute
 * variation de `gap` mesure EXACTEMENT l'effet des chemins NON couverts (void tant
 * que F2 non livré, inventory_adjust tant que F1b non livré). C'est le critère de
 * bascule F3 : après cutover (solde d'ouverture) + couverture complète, gap → 0.
 * Voir la dette formalisée dans TECHNICAL_DEBT.md (couverture shadow partielle).
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
import { StockModule } from '../src/modules/stock/stock.module';
import { CacheModule } from '../src/common/cache/cache.module';
import { MessagingModule } from '../src/common/messaging/messaging.module';
import { RealtimeModule } from '../src/common/realtime/realtime.module';
import { TimewinModule } from '../src/modules/timewin/timewin.module';
import { SalesService } from '../src/modules/sales/sales.service';
import { ReturnsService } from '../src/modules/returns/returns.service';
import { StockService } from '../src/modules/stock/stock.service';
import { SaleEntity } from '../src/database/entities/sale.entity';
import { StoreEntity } from '../src/database/entities/store.entity';
import { ProductEntity } from '../src/database/entities/product.entity';

const TEST_DB = process.env.TEST_DATABASE_URL;
const d = TEST_DB ? describe : describe.skip;

/** Instrument réutilisable — SELECT PUR, aucune écriture. */
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

d('Réconciliation scalaire vs SUM(mouvements) — lecture seule (real Postgres)', () => {
  let moduleRef: TestingModule;
  let ds: DataSource;
  let sales: SalesService;
  let returns: ReturnsService;
  let stock: StockService;
  const STORE = uuidv4();
  const EMP = uuidv4();
  const EAN = '3200000000001';
  let productId: string;
  const snap = { employeeName: 'Alice', employeeRole: 'admin', maxDiscount: 100 };

  const reconcile = async (): Promise<{ scalar_stock: number; journal_sum: number; gap: number }> => {
    const rows = await ds.query(RECONCILE_SQL, [STORE, productId]);
    return rows[0];
  };

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        TypeOrmModule.forRoot({ type: 'postgres', url: TEST_DB, entities: loadAllEntities() as any, synchronize: true, extra: { max: 15 } }),
        CacheModule, MessagingModule, RealtimeModule, TimewinModule, SalesModule, ReturnsModule, StockModule,
      ],
    }).compile();
    ds = moduleRef.get(DataSource);
    sales = moduleRef.get(SalesService);
    returns = moduleRef.get(ReturnsService);
    stock = moduleRef.get(StockService);
    await ds.getRepository(StoreEntity).save({ id: STORE, name: 'B45', storeCode: 'B45', currencyCode: 'EUR', isActive: true } as any);
    productId = uuidv4();
    await ds.getRepository(ProductEntity).save({
      id: productId, storeId: STORE, ean: EAN, name: 'Thé', priceMinorUnits: 500, taxRate: 20, stockQuantity: 100, isActive: true,
    } as any);
    process.env.STOCK_JOURNAL_SHADOW = 'true';
  });

  afterAll(async () => {
    delete process.env.STOCK_JOURNAL_SHADOW;
    await moduleRef?.close();
  });

  it('produit vierge : gap == scalaire (solde d\'ouverture implicite), journal_sum 0', async () => {
    const r = await reconcile();
    expect(r.scalar_stock).toBe(100);
    expect(r.journal_sum).toBe(0);
    expect(r.gap).toBe(100);
  }, 60000);

  it('chemins COUVERTS (vente puis retour) : le gap reste CONSTANT', async () => {
    const sale: any = await sales.createSale(
      STORE, EMP,
      { items: [{ ean: EAN, quantity: 3 }], payments: [{ method: 'cash', amountMinorUnits: 1500 }] } as any,
      snap, `rec-sale-${uuidv4()}`,
    );
    let r = await reconcile();
    expect(r.scalar_stock).toBe(97);
    expect(r.journal_sum).toBe(-3);
    expect(r.gap).toBe(100); // inchangé

    const full = await ds.getRepository(SaleEntity).findOne({ where: { id: sale.id }, relations: ['lineItems'] });
    await returns.createReturn(
      STORE, EMP,
      { originalSaleId: sale.id, items: [{ lineItemId: full!.lineItems[0].id, quantity: 1 }], refundMethod: 'cash' } as any,
      'Alice',
    );
    r = await reconcile();
    expect(r.scalar_stock).toBe(98);
    expect(r.journal_sum).toBe(-2); // -3 (vente) +1 (retour)
    expect(r.gap).toBe(100); // TOUJOURS constant tant que couvert
  }, 60000);

  it('chemin NON couvert (inventory_adjust) : le gap varie EXACTEMENT de l\'effet non journalisé', async () => {
    const before = await reconcile();
    // Ajustement −5 : bouge le scalaire, N'écrit PAS de mouvement (F1b non livré).
    await stock.adjustStock(productId, -5, STORE, EMP, 'casse constatée', 'delta');
    const after = await reconcile();
    expect(after.scalar_stock).toBe(before.scalar_stock - 5);
    expect(after.journal_sum).toBe(before.journal_sum); // journal inchangé
    // L'instrument révèle l'écart : le gap a bougé de exactement −5 = l'effet non couvert.
    expect(after.gap).toBe(before.gap - 5);
    expect(after.gap).toBe(95);
  }, 60000);
});
