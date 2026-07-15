/**
 * Journal de stock unifié — bloc F2 : mouvement inverse `void` + CORRECTIF G3.
 * Gated sur TEST_DATABASE_URL. Vrai Postgres.
 *
 *   TEST_DATABASE_URL=postgresql://user@localhost:5432/caisse_void \
 *     npx jest --forceExit test/stock-journal-void-f2.pg.spec.ts
 *
 * Prouve :
 *  - **G3 (rouge→vert)** : le void d'une vente de pack restitue le parent ET les composants
 *    (avant F2 : les composants étaient perdus définitivement — fuite de stock) ;
 *  - la restitution vient du SNAPSHOT figé (`sale_component_movements`), pas de la composition
 *    courante — une composition modifiée après la vente ne change rien au void ;
 *  - flag ON : mouvements inverses `void` écrits pour parent ET composants ;
 *  - le HASH de la vente d'origine est INCHANGÉ par le void (append-only, maillon fiscal séparé) ;
 *  - idempotence : void rejoué (même clé) → aucune double-restitution, aucun mouvement dupliqué.
 *
 * Note : le void est interdit si un leg cash est réalisé → les ventes de ce spec paient en `card`.
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
import { ProductComponentEntity } from '../src/database/entities/product-component.entity';
import { StockMovementEntity } from '../src/database/entities/stock-movement.entity';
import { FiscalJournalEntity } from '../src/database/entities/fiscal-journal.entity';

const TEST_DB = process.env.TEST_DATABASE_URL;
const d = TEST_DB ? describe : describe.skip;

d('F2 — void inverse + correctif G3 (real Postgres)', () => {
  let moduleRef: TestingModule;
  let ds: DataSource;
  let sales: SalesService;
  const STORE = uuidv4();
  const EMP = uuidv4();
  const EAN_PACK = '3300000000001';
  const snap = { employeeName: 'Alice', employeeRole: 'admin', maxDiscount: 100 };
  let parentId: string;
  let componentId: string;

  const qty = async (id: string): Promise<number> =>
    (await ds.getRepository(ProductEntity).findOneByOrFail({ id })).stockQuantity;
  const sellPack = async (key: string): Promise<any> =>
    sales.createSale(
      STORE, EMP,
      { items: [{ ean: EAN_PACK, quantity: 1 }], payments: [{ method: 'card', amountMinorUnits: 1500 }] } as any,
      snap, key,
    );

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        TypeOrmModule.forRoot({ type: 'postgres', url: TEST_DB, entities: loadAllEntities() as any, synchronize: true, extra: { max: 15 } }),
        CacheModule, MessagingModule, RealtimeModule, TimewinModule, SalesModule,
      ],
    }).compile();
    ds = moduleRef.get(DataSource);
    sales = moduleRef.get(SalesService);
    await ds.getRepository(StoreEntity).save({ id: STORE, name: 'B46', storeCode: 'B46', currencyCode: 'EUR', isActive: true } as any);
    parentId = uuidv4();
    componentId = uuidv4();
    await ds.getRepository(ProductEntity).save([
      { id: parentId, storeId: STORE, ean: EAN_PACK, name: 'Coffret', priceMinorUnits: 1500, taxRate: 20, stockQuantity: 50, isActive: true },
      { id: componentId, storeId: STORE, ean: '3300000000002', name: 'Mug', priceMinorUnits: 300, taxRate: 20, stockQuantity: 50, isActive: true },
    ] as any);
    await ds.getRepository(ProductComponentEntity).save({
      id: uuidv4(), storeId: STORE, parentProductId: parentId, componentProductId: componentId, quantityPerParent: 3, isActive: true,
    } as any);
  });

  afterEach(() => { delete process.env.STOCK_JOURNAL_SHADOW; });
  afterAll(async () => { await moduleRef?.close(); });

  it('G3 (rouge→vert) : void d\'un pack restitue le parent ET les composants', async () => {
    const p0 = await qty(parentId);
    const c0 = await qty(componentId);

    const sale: any = await sellPack(`g3-${uuidv4()}`);
    expect(await qty(parentId)).toBe(p0 - 1);
    expect(await qty(componentId)).toBe(c0 - 3); // 3 × 1

    await sales.voidSale(sale.id, EMP, STORE, 'admin', 100, 'test G3', `g3v-${uuidv4()}`);

    expect(await qty(parentId)).toBe(p0);      // +1 (déjà OK avant F2)
    expect(await qty(componentId)).toBe(c0);   // +3 — AVANT F2 : restait à c0-3 (fuite)
  }, 60000);

  it('restitution depuis le SNAPSHOT figé (composition modifiée après la vente sans effet)', async () => {
    const c0 = await qty(componentId);
    const sale: any = await sellPack(`snap-${uuidv4()}`);
    expect(await qty(componentId)).toBe(c0 - 3);

    // La composition courante change APRÈS la vente (3 → 7). Le void doit ignorer ce changement.
    await ds.getRepository(ProductComponentEntity).update(
      { storeId: STORE, parentProductId: parentId, componentProductId: componentId },
      { quantityPerParent: 7 },
    );
    await sales.voidSale(sale.id, EMP, STORE, 'admin', 100, 'test snapshot', `snapv-${uuidv4()}`);
    expect(await qty(componentId)).toBe(c0); // +3 (snapshot), PAS +7

    await ds.getRepository(ProductComponentEntity).update(
      { storeId: STORE, parentProductId: parentId, componentProductId: componentId },
      { quantityPerParent: 3 },
    );
  }, 60000);

  it('flag ON : mouvements inverses \'void\' pour parent ET composant', async () => {
    process.env.STOCK_JOURNAL_SHADOW = 'true';
    const sale: any = await sellPack(`mv-${uuidv4()}`);
    await sales.voidSale(sale.id, EMP, STORE, 'admin', 100, 'test mvts', `mvv-${uuidv4()}`);

    const mvts = await ds.getRepository(StockMovementEntity).find({ where: { saleId: sale.id } });
    const byType = (t: string) => mvts.filter((m) => m.movementType === t);
    expect(byType('sale')).toHaveLength(1);
    expect(byType('pack_consumption')).toHaveLength(1);
    const voids = byType('void');
    expect(voids).toHaveLength(2); // parent + composant
    const vParent = voids.find((m) => m.productId === parentId)!;
    const vComp = voids.find((m) => m.productId === componentId)!;
    expect(vParent.quantity).toBe(1);
    expect(vComp.quantity).toBe(3);
    expect(vParent.storeId).toBe(STORE);
    expect(vComp.reference).toBe((await ds.getRepository(SaleEntity).findOneByOrFail({ id: sale.id })).ticketNumber);
  }, 60000);

  it('le HASH de la vente d\'origine est INCHANGÉ par le void (+ maillon fiscal void écrit)', async () => {
    process.env.STOCK_JOURNAL_SHADOW = 'true';
    const sale: any = await sellPack(`hash-${uuidv4()}`);
    const before = await ds.getRepository(SaleEntity).findOneByOrFail({ id: sale.id });
    const hashBefore = before.hashChainCurrent;
    const prevBefore = before.hashChainPrev;

    await sales.voidSale(sale.id, EMP, STORE, 'admin', 100, 'test hash', `hashv-${uuidv4()}`);

    const after = await ds.getRepository(SaleEntity).findOneByOrFail({ id: sale.id });
    expect(after.status).toBe('voided');
    expect(after.hashChainCurrent).toBe(hashBefore); // jamais re-hashée
    expect(after.hashChainPrev).toBe(prevBefore);

    const link = await ds.getRepository(FiscalJournalEntity).findOne({ where: { refId: sale.id, eventType: 'void' } });
    expect(link).toBeTruthy();
    expect(link!.hashChainCurrent).toMatch(/^[0-9a-f]{64}$/);
  }, 60000);

  it('idempotence : void rejoué (même clé) → pas de double-restitution ni de mouvement dupliqué', async () => {
    process.env.STOCK_JOURNAL_SHADOW = 'true';
    const p0 = await qty(parentId);
    const c0 = await qty(componentId);
    const sale: any = await sellPack(`idem-${uuidv4()}`);
    const voidKey = `idemv-${uuidv4()}`;

    await sales.voidSale(sale.id, EMP, STORE, 'admin', 100, 'r1', voidKey);
    const pAfter = await qty(parentId);
    const cAfter = await qty(componentId);
    expect(pAfter).toBe(p0);
    expect(cAfter).toBe(c0);

    await sales.voidSale(sale.id, EMP, STORE, 'admin', 100, 'r1', voidKey); // rejeu
    expect(await qty(parentId)).toBe(pAfter);   // pas de +1 supplémentaire
    expect(await qty(componentId)).toBe(cAfter); // pas de +3 supplémentaire
    const voids = (await ds.getRepository(StockMovementEntity).find({ where: { saleId: sale.id } }))
      .filter((m) => m.movementType === 'void');
    expect(voids).toHaveLength(2); // toujours 2, pas 4
  }, 60000);
});
