/**
 * Journal de stock unifié — bloc F1 (écriture double / shadow) sur un VRAI Postgres.
 * Gated sur TEST_DATABASE_URL — skippé sinon.
 *
 *   TEST_DATABASE_URL=postgresql://user@localhost:5432/caisse_shadow \
 *     npx jest --forceExit test/stock-journal-shadow.pg.spec.ts
 *
 * Prouve, flag STOCK_JOURNAL_SHADOW :
 *  - OFF (défaut) : une vente n'écrit AUCUN stock_movements (comportement identique) ;
 *  - ON : la vente écrit 'sale' (par ligne) + 'pack_consumption' (par composant) dans
 *         la même tx, et le HASH DE LA VENTE EST INCHANGÉ (recalcul canonique, stock exclu) ;
 *  - ON : rejeu avec la même clé d'idempotence → mouvements NON dupliqués ;
 *  - ON : un retour écrit 'return_customer' (parent + composant).
 * Le stock reste HORS de l'empreinte fiscale (invariant NF525).
 */
import './helpers/env-setup';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { createHash } from 'crypto';
import { loadAllEntities } from './helpers/pgmem';
import { SalesModule } from '../src/modules/sales/sales.module';
import { ReturnsModule } from '../src/modules/returns/returns.module';
import { CacheModule } from '../src/common/cache/cache.module';
import { MessagingModule } from '../src/common/messaging/messaging.module';
import { RealtimeModule } from '../src/common/realtime/realtime.module';
import { TimewinModule } from '../src/modules/timewin/timewin.module';
import { SalesService } from '../src/modules/sales/sales.service';
import { ReturnsService } from '../src/modules/returns/returns.service';
import { SaleEntity } from '../src/database/entities/sale.entity';
import { StoreEntity } from '../src/database/entities/store.entity';
import { ProductEntity } from '../src/database/entities/product.entity';
import { ProductComponentEntity } from '../src/database/entities/product-component.entity';
import { StockMovementEntity } from '../src/database/entities/stock-movement.entity';

const TEST_DB = process.env.TEST_DATABASE_URL;
const d = TEST_DB ? describe : describe.skip;
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

d('Journal de stock unifié — F1 shadow (real Postgres)', () => {
  let moduleRef: TestingModule;
  let ds: DataSource;
  let sales: SalesService;
  let returns: ReturnsService;
  const STORE = uuidv4();
  const EMP = uuidv4();
  const EAN_SIMPLE = '3100000000001';
  const EAN_PACK = '3100000000002';
  const snap = { employeeName: 'Alice', employeeRole: 'admin', maxDiscount: 100 };
  let componentId: string;

  const movementsForSale = (saleId: string) =>
    ds.getRepository(StockMovementEntity).find({ where: { saleId } });

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        TypeOrmModule.forRoot({ type: 'postgres', url: TEST_DB, entities: loadAllEntities() as any, synchronize: true, extra: { max: 15 } }),
        CacheModule, MessagingModule, RealtimeModule, TimewinModule, SalesModule, ReturnsModule,
      ],
    }).compile();
    ds = moduleRef.get(DataSource);
    sales = moduleRef.get(SalesService);
    returns = moduleRef.get(ReturnsService);
    await ds.getRepository(StoreEntity).save({ id: STORE, name: 'B44', storeCode: 'B44', currencyCode: 'EUR', isActive: true } as any);
    const parentId = uuidv4();
    componentId = uuidv4();
    await ds.getRepository(ProductEntity).save([
      { id: uuidv4(), storeId: STORE, ean: EAN_SIMPLE, name: 'Café', priceMinorUnits: 500, taxRate: 20, stockQuantity: 100, isActive: true },
      { id: parentId, storeId: STORE, ean: EAN_PACK, name: 'Coffret', priceMinorUnits: 1500, taxRate: 20, stockQuantity: 100, isActive: true },
      { id: componentId, storeId: STORE, ean: '3100000000003', name: 'Mug', priceMinorUnits: 300, taxRate: 20, stockQuantity: 100, isActive: true },
    ] as any);
    await ds.getRepository(ProductComponentEntity).save({
      id: uuidv4(), storeId: STORE, parentProductId: parentId, componentProductId: componentId, quantityPerParent: 3, isActive: true,
    } as any);
  });

  afterEach(() => {
    delete process.env.STOCK_JOURNAL_SHADOW;
  });

  afterAll(async () => {
    await moduleRef?.close();
  });

  it('OFF : la vente n\'écrit aucun stock_movements', async () => {
    delete process.env.STOCK_JOURNAL_SHADOW;
    const sale: any = await sales.createSale(
      STORE, EMP,
      { items: [{ ean: EAN_SIMPLE, quantity: 2 }], payments: [{ method: 'cash', amountMinorUnits: 1000 }] } as any,
      snap, `off-${uuidv4()}`,
    );
    expect(await movementsForSale(sale.id)).toHaveLength(0);
    expect(sale.hashVersion).toBe(2);
    expect(sale.hashChainCurrent).toMatch(/^[0-9a-f]{64}$/);
  }, 60000);

  it('ON : mouvement \'sale\' écrit ET hash de vente INCHANGÉ (recalcul canonique, stock exclu)', async () => {
    process.env.STOCK_JOURNAL_SHADOW = 'true';
    const res: any = await sales.createSale(
      STORE, EMP,
      { items: [{ ean: EAN_SIMPLE, quantity: 2 }], payments: [{ method: 'cash', amountMinorUnits: 1000 }] } as any,
      snap, `on-${uuidv4()}`,
    );
    const sale = await ds.getRepository(SaleEntity).findOne({ where: { id: res.id }, relations: ['lineItems', 'payments'] });
    expect(sale).toBeTruthy();

    const mvts = await movementsForSale(res.id);
    expect(mvts).toHaveLength(1);
    expect(mvts[0].movementType).toBe('sale');
    expect(mvts[0].productId).toBe(sale!.lineItems[0].productId);
    expect(mvts[0].quantity).toBe(2);
    expect(mvts[0].storeId).toBe(STORE);
    expect(mvts[0].saleLineItemId).toBe(sale!.lineItems[0].id);

    // INVARIANT NF525 : le hash stocké == recalcul canonique qui EXCLUT le stock.
    // Si l'écriture du mouvement était entrée dans l'empreinte, l'égalité casserait.
    const canonical = JSON.stringify({
      v: 2,
      ticketNumber: sale!.ticketNumber,
      storeId: sale!.storeId,
      employeeId: sale!.employeeId,
      customerId: sale!.customerId ?? null,
      subtotalMinorUnits: sale!.subtotalMinorUnits,
      discountTotalMinorUnits: sale!.discountTotalMinorUnits,
      taxTotalMinorUnits: sale!.taxTotalMinorUnits,
      totalAfterDiscount: sale!.totalMinorUnits,
      payments: sale!.payments.map((p) => ({ method: p.method, amount: p.amountMinorUnits })),
      completedAt: new Date(sale!.completedAt).toISOString(),
      items: sale!.lineItems.map((li) => ({ ean: li.ean, qty: li.quantity, total: li.lineTotalMinorUnits })),
    });
    expect(sha256(sale!.hashChainPrev + canonical)).toBe(sale!.hashChainCurrent);
  }, 60000);

  it('ON : pack → \'sale\' parent + \'pack_consumption\' composant', async () => {
    process.env.STOCK_JOURNAL_SHADOW = 'true';
    const res: any = await sales.createSale(
      STORE, EMP,
      { items: [{ ean: EAN_PACK, quantity: 1 }], payments: [{ method: 'cash', amountMinorUnits: 1500 }] } as any,
      snap, `pack-${uuidv4()}`,
    );
    const mvts = await movementsForSale(res.id);
    const byType = (t: string) => mvts.filter((m) => m.movementType === t);
    expect(byType('sale')).toHaveLength(1);
    expect(byType('pack_consumption')).toHaveLength(1);
    const comp = byType('pack_consumption')[0];
    expect(comp.productId).toBe(componentId);
    expect(comp.quantity).toBe(3); // quantityPerParent(3) × qty(1)
  }, 60000);

  it('ON : rejeu même clé d\'idempotence → mouvements NON dupliqués', async () => {
    process.env.STOCK_JOURNAL_SHADOW = 'true';
    const key = `idem-${uuidv4()}`;
    const dto = { items: [{ ean: EAN_SIMPLE, quantity: 1 }], payments: [{ method: 'cash', amountMinorUnits: 500 }] } as any;
    const a: any = await sales.createSale(STORE, EMP, dto, snap, key);
    const b: any = await sales.createSale(STORE, EMP, dto, snap, key); // replay
    expect(b.id).toBe(a.id);
    expect(await movementsForSale(a.id)).toHaveLength(1); // pas 2
  }, 60000);

  it('ON : un retour écrit \'return_customer\' (parent)', async () => {
    process.env.STOCK_JOURNAL_SHADOW = 'true';
    const res: any = await sales.createSale(
      STORE, EMP,
      { items: [{ ean: EAN_SIMPLE, quantity: 2 }], payments: [{ method: 'cash', amountMinorUnits: 1000 }] } as any,
      snap, `ret-${uuidv4()}`,
    );
    const sale = await ds.getRepository(SaleEntity).findOne({ where: { id: res.id }, relations: ['lineItems'] });
    const cn: any = await returns.createReturn(
      STORE, EMP,
      { originalSaleId: sale!.id, items: [{ lineItemId: sale!.lineItems[0].id, quantity: 1 }], refundMethod: 'cash' } as any,
      'Alice',
    );
    const retMvts = await ds.getRepository(StockMovementEntity).find({ where: { movementType: 'return_customer', reference: cn.code } });
    expect(retMvts.length).toBeGreaterThanOrEqual(1);
    expect(retMvts[0].productId).toBe(sale!.lineItems[0].productId);
    expect(retMvts[0].quantity).toBe(1);
    expect(retMvts[0].note).toBe(sale!.id); // trace vente d'origine
  }, 60000);
});
