/**
 * GO Product Packs (owner 2026-07-09) — packs d'articles / produits composés.
 *
 * Règle métier : le parent est la seule ligne commerciale (prix/CA/ticket) ;
 * les composants actifs sortent du stock automatiquement à la vente
 * (quantity_per_parent × qty) et y reviennent au retour SELON LE SNAPSHOT
 * figé au moment de la vente (sale_component_movements) — jamais selon la
 * composition courante. Le snapshot vit HORS de l'empreinte hash des ventes
 * (pattern session_id/terminal_id) : l'allowlist v2 est inchangée.
 *
 * L'atomicité sous CONCURRENCE réelle (rollback complet si un composant
 * manque en pleine transaction) est prouvée sur vrai Postgres dans
 * product-packs-concurrency.pg.spec.ts — pg-mem n'honore pas le rollback
 * d'un queryRunner dédié.
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
import { FiscalJournalEntity } from '../src/database/entities/fiscal-journal.entity';

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

describe('Product Packs — produits composés (vente, snapshot, retours, anti-boucle)', () => {
  let moduleRef: TestingModule;
  let ds: DataSource;
  let sales: SalesService;
  let returns: ReturnsService;
  let products: ProductsService;
  const STORE_ID = uuidv4();
  const OTHER_STORE_ID = uuidv4();
  const EMP_ID = uuidv4();
  const SNAP = { employeeName: 'Alice', employeeRole: 'admin', maxDiscount: 100 };

  // Produits du magasin principal
  const PACK_ID = uuidv4();     // Humidificateur — 19,99 € (parent facturé)
  const COMP1_ID = uuidv4();    // Cristalline 50 cl (composant)
  const COMP2_ID = uuidv4();    // Câble USB (composant)
  const SIMPLE_ID = uuidv4();   // produit simple, sans composition
  const CHAIN_B_ID = uuidv4();  // pour l'anti-boucle indirecte
  const CHAIN_C_ID = uuidv4();
  const FOREIGN_ID = uuidv4();  // produit d'un AUTRE magasin

  const EAN_PACK = '7000000000010';
  const EAN_COMP1 = '7000000000027';
  const EAN_COMP2 = '7000000000034';
  const EAN_SIMPLE = '7000000000041';

  const mkProduct = (id: string, storeId: string, ean: string, name: string, price: number, stock: number) => ({
    id, storeId, ean, name, priceMinorUnits: price, taxRate: 20,
    stockQuantity: stock, stockAlertThreshold: 5, stockCriticalThreshold: 2, isActive: true,
  });

  beforeAll(async () => {
    const { dataSource } = createPgMemDataSource();
    moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        TypeOrmModule.forRootAsync({
          useFactory: () => ({ type: 'postgres', entities: loadAllEntities() as any, synchronize: true }),
          dataSourceFactory: async () => (dataSource.isInitialized ? dataSource : dataSource.initialize()),
        }),
        CacheModule, MessagingModule, RealtimeModule, TimewinModule,
        ProductsModule, SalesModule, ReturnsModule,
      ],
    }).compile();
    ds = moduleRef.get(DataSource);
    sales = moduleRef.get(SalesService);
    returns = moduleRef.get(ReturnsService);
    products = moduleRef.get(ProductsService);

    await ds.getRepository(StoreEntity).save([
      { id: STORE_ID, name: 'S', storeCode: 'PK1', currencyCode: 'EUR', isActive: true },
      { id: OTHER_STORE_ID, name: 'T', storeCode: 'PK2', currencyCode: 'EUR', isActive: true },
    ] as any);
    await ds.getRepository(ProductEntity).save([
      mkProduct(PACK_ID, STORE_ID, EAN_PACK, 'Humidificateur', 1999, 100),
      mkProduct(COMP1_ID, STORE_ID, EAN_COMP1, 'Cristalline 50cl', 100, 100),
      mkProduct(COMP2_ID, STORE_ID, EAN_COMP2, 'Câble USB', 300, 100),
      mkProduct(SIMPLE_ID, STORE_ID, EAN_SIMPLE, 'Produit simple', 500, 100),
      mkProduct(CHAIN_B_ID, STORE_ID, '7000000000058', 'Maillon B', 100, 100),
      mkProduct(CHAIN_C_ID, STORE_ID, '7000000000065', 'Maillon C', 100, 100),
      mkProduct(FOREIGN_ID, OTHER_STORE_ID, '7000000000072', 'Produit autre magasin', 100, 100),
    ] as any);
  });

  afterAll(async () => { await moduleRef?.close(); });

  const stockOf = async (id: string) =>
    (await ds.getRepository(ProductEntity).findOne({ where: { id } }))!.stockQuantity;
  const setStock = (id: string, q: number) =>
    ds.getRepository(ProductEntity).update({ id }, { stockQuantity: q });

  const sellPack = (qty = 1, ean = EAN_PACK, unitPrice = 1999) =>
    sales.createSale(
      STORE_ID, EMP_ID,
      { items: [{ ean, quantity: qty }], payments: [{ method: 'cash', amountMinorUnits: unitPrice * qty }] } as any,
      SNAP,
    ) as any;

  const movementsOf = (saleId: string) =>
    ds.getRepository(SaleComponentMovementEntity).find({ where: { saleId } });

  // ── CRUD + garde-fous de composition ──────────────────────────────

  it('CRUD — ajout d\'un composant : validations (qté > 0, self-inclusion, doublon)', async () => {
    await expect(products.addComponent(PACK_ID, STORE_ID, { componentProductId: PACK_ID, quantityPerParent: 1 }))
      .rejects.toThrow(/lui-même/);
    await expect(products.addComponent(PACK_ID, STORE_ID, { componentProductId: COMP1_ID, quantityPerParent: 0 }))
      .rejects.toThrow(/strictement positif/);
    await expect(products.addComponent(PACK_ID, STORE_ID, { componentProductId: COMP1_ID, quantityPerParent: 1.5 }))
      .rejects.toThrow(/strictement positif/);

    const row = await products.addComponent(PACK_ID, STORE_ID, { componentProductId: COMP1_ID, quantityPerParent: 1 });
    expect(row.id).toBeTruthy();
    expect(row.isActive).toBe(true);

    // Doublon → conflit explicite (jamais deux lignes pour le même couple)
    await expect(products.addComponent(PACK_ID, STORE_ID, { componentProductId: COMP1_ID, quantityPerParent: 2 }))
      .rejects.toThrow(/déjà un composant/);

    const list = await products.listComponents(PACK_ID, STORE_ID);
    expect(list).toHaveLength(1);
    expect(list[0].componentName).toBe('Cristalline 50cl');
    expect(list[0].quantityPerParent).toBe(1);
  });

  it('anti-boucle DIRECTE — A contient B ⇒ B ne peut pas contenir A', async () => {
    // PACK ⊃ COMP2 (posé ici pour le reste de la suite)
    await products.addComponent(PACK_ID, STORE_ID, { componentProductId: COMP2_ID, quantityPerParent: 2 });
    await expect(products.addComponent(COMP2_ID, STORE_ID, { componentProductId: PACK_ID, quantityPerParent: 1 }))
      .rejects.toThrow(/[Bb]oucle/);
  });

  it('anti-boucle INDIRECTE — A ⊃ B ⊃ C ⇒ C ne peut pas contenir A', async () => {
    await products.addComponent(CHAIN_B_ID, STORE_ID, { componentProductId: CHAIN_C_ID, quantityPerParent: 1 });
    await products.addComponent(PACK_ID, STORE_ID, { componentProductId: CHAIN_B_ID, quantityPerParent: 1 });
    // PACK ⊃ B ⊃ C : C ⊃ PACK fermerait le cycle → refus
    await expect(products.addComponent(CHAIN_C_ID, STORE_ID, { componentProductId: PACK_ID, quantityPerParent: 1 }))
      .rejects.toThrow(/[Bb]oucle/);
    // Nettoyage : la suite vente/retour teste PACK ⊃ {COMP1, COMP2} uniquement.
    const list = await products.listComponents(PACK_ID, STORE_ID);
    const chainRow = list.find((c: any) => c.componentProductId === CHAIN_B_ID)!;
    await products.removeComponent(PACK_ID, chainRow.id, STORE_ID);
  });

  it('isolation magasin — composant ou parent d\'un autre magasin refusés', async () => {
    await expect(products.addComponent(PACK_ID, STORE_ID, { componentProductId: FOREIGN_ID, quantityPerParent: 1 }))
      .rejects.toThrow(/another store|introuvable|not found/i);
    await expect(products.listComponents(PACK_ID, OTHER_STORE_ID))
      .rejects.toThrow(/another store|not found/i);
  });

  // ── Moteur de vente ────────────────────────────────────────────────

  it('produit SIMPLE — aucun mouvement composant, stock composants intact', async () => {
    const before1 = await stockOf(COMP1_ID);
    const sale = await sales.createSale(
      STORE_ID, EMP_ID,
      { items: [{ ean: EAN_SIMPLE, quantity: 1 }], payments: [{ method: 'cash', amountMinorUnits: 500 }] } as any,
      SNAP,
    ) as any;
    expect(await movementsOf(sale.id)).toHaveLength(0);
    expect(await stockOf(COMP1_ID)).toBe(before1);
  });

  // NOTE pg-mem (quirk documentée du repo) : l'arithmétique paramétrée
  // `SET stock = stock - $1` est MAL évaluée par pg-mem (résultat $1 - stock),
  // alors que `stock + $1` est correct. Les DELTAS exacts de décrément
  // (parent + composants) sont donc prouvés sur vrai Postgres dans
  // product-packs-concurrency.pg.spec.ts ; ici on prouve le snapshot
  // (quantités consommées), le ticket, le hash, les refus — et les
  // RESTAURATIONS de retour en re-seedant le stock après la vente.

  it('vente d\'un pack — 1 ligne ticket, snapshot figé (quantités consommées), hash INCHANGÉ', async () => {
    await setStock(PACK_ID, 100); await setStock(COMP1_ID, 100); await setStock(COMP2_ID, 100);
    const sale = await sellPack(1);

    // Une seule ligne commerciale : le parent. Aucun composant sur le ticket.
    expect(sale.lineItems).toHaveLength(1);
    expect(sale.lineItems[0].productId).toBe(PACK_ID);
    expect(sale.totalMinorUnits).toBe(1999); // tout le CA sur le parent

    // Snapshot + traçabilité : une ligne par composant consommé
    const moves = await movementsOf(sale.id);
    expect(moves).toHaveLength(2);
    const m1 = moves.find((m) => m.componentProductId === COMP1_ID)!;
    expect(m1.quantityPerParent).toBe(1);
    expect(m1.quantityConsumed).toBe(1);
    expect(m1.parentProductId).toBe(PACK_ID);
    expect(m1.saleLineItemId).toBe(sale.lineItems[0].id);
    expect(m1.storeId).toBe(STORE_ID);
    expect(m1.employeeId).toBe(EMP_ID);
    const m2 = moves.find((m) => m.componentProductId === COMP2_ID)!;
    expect(m2.quantityConsumed).toBe(2);

    // L'empreinte fiscale v2 reste auto-cohérente sur l'allowlist INCHANGÉE
    // (aucune clé pack dans le payload hashé) — preuve que le snapshot est
    // bien HORS hash.
    const stored: any = await ds.getRepository('sales').findOne({ where: { id: sale.id } });
    const payload = JSON.stringify({
      v: 2,
      ticketNumber: stored.ticketNumber,
      storeId: STORE_ID,
      employeeId: EMP_ID,
      customerId: null,
      subtotalMinorUnits: 1999,
      discountTotalMinorUnits: 0,
      taxTotalMinorUnits: stored.taxTotalMinorUnits,
      totalAfterDiscount: 1999,
      payments: [{ method: 'cash', amount: 1999 }],
      completedAt: new Date(stored.completedAt).toISOString(),
      items: [{ ean: EAN_PACK, qty: 1, total: 1999 }],
    });
    expect(stored.hashChainCurrent).toBe(sha256(stored.hashChainPrev + payload));
  });

  it('vente quantité 2 — composants multipliés dans le snapshot (2× et 4×)', async () => {
    await setStock(PACK_ID, 100); await setStock(COMP1_ID, 100); await setStock(COMP2_ID, 100);
    const sale = await sellPack(2);
    const moves = await movementsOf(sale.id);
    expect(moves).toHaveLength(2);
    expect(moves.find((m) => m.componentProductId === COMP1_ID)!.quantityConsumed).toBe(2);  // 1 × 2
    expect(moves.find((m) => m.componentProductId === COMP2_ID)!.quantityConsumed).toBe(4);  // 2 × 2
  });

  it('composant DÉSACTIVÉ — ni décrémenté ni snapshoté', async () => {
    const list = await products.listComponents(PACK_ID, STORE_ID);
    const cable = list.find((c: any) => c.componentProductId === COMP2_ID)!;
    await products.updateComponent(PACK_ID, cable.id, STORE_ID, { isActive: false });

    await setStock(PACK_ID, 100); await setStock(COMP1_ID, 100); await setStock(COMP2_ID, 100);
    const sale = await sellPack(1);
    expect(await stockOf(COMP2_ID)).toBe(100); // inactif → JAMAIS touché
    const moves = await movementsOf(sale.id);
    expect(moves).toHaveLength(1);
    expect(moves[0].componentProductId).toBe(COMP1_ID);

    await products.updateComponent(PACK_ID, cable.id, STORE_ID, { isActive: true });
  });

  it('stock composant INSUFFISANT — vente refusée, aucun stock touché, aucune vente créée', async () => {
    await setStock(PACK_ID, 100); await setStock(COMP1_ID, 0); await setStock(COMP2_ID, 100);
    const salesBefore = await ds.getRepository('sales').count({ where: { storeId: STORE_ID } });
    await expect(sellPack(1)).rejects.toThrow(/composant.*Cristalline|Cristalline.*composant/s);
    expect(await stockOf(PACK_ID)).toBe(100);
    expect(await stockOf(COMP2_ID)).toBe(100);
    expect(await ds.getRepository('sales').count({ where: { storeId: STORE_ID } })).toBe(salesBefore);
  });

  // ── Retours / avoirs ──────────────────────────────────────────────

  it('retour COMPLET — parent + composants restaurés selon le snapshot, scellé dans stock_restored', async () => {
    await setStock(PACK_ID, 100); await setStock(COMP1_ID, 100); await setStock(COMP2_ID, 100);
    const sale = await sellPack(1);
    // Re-seed APRÈS la vente (le décrément pg-mem est buggué, la restauration
    // `+ $1` est correcte) : on prouve exactement ce que le retour restaure.
    await setStock(PACK_ID, 10); await setStock(COMP1_ID, 10); await setStock(COMP2_ID, 10);
    const cn: any = await returns.createReturn(
      STORE_ID, EMP_ID,
      { originalSaleId: sale.id, items: [{ lineItemId: sale.lineItems[0].id, quantity: 1 }], reason: 'défectueux', refundMethod: 'cash' } as any,
      'Alice',
    );
    expect(await stockOf(PACK_ID)).toBe(11);   // +1 parent
    expect(await stockOf(COMP1_ID)).toBe(11);  // +1 (ratio 1)
    expect(await stockOf(COMP2_ID)).toBe(12);  // +2 (ratio 2)

    // Le maillon stock_restored scelle parents ET composants restaurés.
    const link = (await ds.getRepository(FiscalJournalEntity).find({ where: { refId: cn.id, eventType: 'stock_restored' } }))[0];
    expect(link).toBeTruthy();
    const payload = JSON.parse(link.payload);
    expect(payload.restored).toEqual([{ productId: PACK_ID, quantity: 1 }]);
    expect(payload.componentsRestored).toEqual(
      expect.arrayContaining([
        { parentProductId: PACK_ID, componentProductId: COMP1_ID, quantity: 1 },
        { parentProductId: PACK_ID, componentProductId: COMP2_ID, quantity: 2 },
      ]),
    );
  });

  it('retour PARTIEL — vente ×2, retour ×1 : composants restaurés au prorata', async () => {
    await setStock(PACK_ID, 100); await setStock(COMP1_ID, 100); await setStock(COMP2_ID, 100);
    const sale = await sellPack(2);
    await setStock(PACK_ID, 10); await setStock(COMP1_ID, 10); await setStock(COMP2_ID, 10);
    await returns.createReturn(
      STORE_ID, EMP_ID,
      { originalSaleId: sale.id, items: [{ lineItemId: sale.lineItems[0].id, quantity: 1 }], reason: 'un seul rendu', refundMethod: 'store_credit' } as any,
      'Alice',
    );
    expect(await stockOf(PACK_ID)).toBe(11);   // +1 (retour de 1 sur 2)
    expect(await stockOf(COMP1_ID)).toBe(11);  // +1×1 (ratio 1, PAS ×2)
    expect(await stockOf(COMP2_ID)).toBe(12);  // +2×1 (ratio 2, PAS ×4)
  });

  it('composition MODIFIÉE après vente — le retour restaure le snapshot d\'origine, pas la composition courante', async () => {
    await setStock(PACK_ID, 100); await setStock(COMP1_ID, 100); await setStock(COMP2_ID, 100); await setStock(CHAIN_B_ID, 100);
    const sale = await sellPack(1); // snapshot : COMP1 ×1, COMP2 ×2

    // On change TOUT après la vente : ratio COMP1 → 5, COMP2 supprimé, B ajouté.
    const list = await products.listComponents(PACK_ID, STORE_ID);
    await products.updateComponent(PACK_ID, list.find((c: any) => c.componentProductId === COMP1_ID)!.id, STORE_ID, { quantityPerParent: 5 });
    await products.removeComponent(PACK_ID, list.find((c: any) => c.componentProductId === COMP2_ID)!.id, STORE_ID);
    await products.addComponent(PACK_ID, STORE_ID, { componentProductId: CHAIN_B_ID, quantityPerParent: 3 });

    await setStock(COMP1_ID, 10); await setStock(COMP2_ID, 10); await setStock(CHAIN_B_ID, 10);
    await returns.createReturn(
      STORE_ID, EMP_ID,
      { originalSaleId: sale.id, items: [{ lineItemId: sale.lineItems[0].id, quantity: 1 }], reason: 'retour', refundMethod: 'store_credit' } as any,
      'Alice',
    );
    // Restauration = snapshot d'origine (1 + 2), PAS la composition courante (5 / B×3).
    expect(await stockOf(COMP1_ID)).toBe(11);   // +1 (pas +5)
    expect(await stockOf(COMP2_ID)).toBe(12);   // +2 (toujours restauré malgré la suppression de la composition)
    expect(await stockOf(CHAIN_B_ID)).toBe(10); // jamais consommé → jamais restauré
  });
});
