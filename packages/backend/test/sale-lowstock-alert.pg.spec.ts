/**
 * At-sale-time low/critical stock alert on a REAL Postgres (gated on
 * TEST_DATABASE_URL; skipped otherwise). The sale decrements stock via inline
 * conditional SQL that bypasses StockService.decrementStock, so the edge-triggered
 * low/critical alert was never fired on a sale — only polling reflected it. pg-mem
 * mis-evaluates the decrement arithmetic (returns bogus stock), so the wiring can
 * only be proven here, where the decrement and RETURNING are faithful.
 *
 *   TEST_DATABASE_URL=postgresql://user@localhost:5432/caisse_lowstock \
 *     npx jest --forceExit test/sale-lowstock-alert.pg.spec.ts
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
import { CacheModule } from '../src/common/cache/cache.module';
import { MessagingModule } from '../src/common/messaging/messaging.module';
import { RealtimeModule } from '../src/common/realtime/realtime.module';
import { TimewinModule } from '../src/modules/timewin/timewin.module';
import { SalesService } from '../src/modules/sales/sales.service';
import { StoreEntity } from '../src/database/entities/store.entity';
import { ProductEntity } from '../src/database/entities/product.entity';
import { AuditEntryEntity } from '../src/database/entities/audit-entry.entity';

const TEST_DB = process.env.TEST_DATABASE_URL;
const d = TEST_DB ? describe : describe.skip;

const SNAP = { employeeName: 'Alice', employeeRole: 'admin', maxDiscount: 100 };

d('At-sale-time low/critical stock alert (real Postgres)', () => {
  let moduleRef: TestingModule;
  let ds: DataSource;
  let sales: SalesService;
  const STORE = uuidv4();
  const EMP = uuidv4();

  const sell = (ean: string, quantity: number, price: number) =>
    sales.createSale(
      STORE, EMP,
      { items: [{ ean, quantity }], payments: [{ method: 'cash', amountMinorUnits: price * quantity }] } as any,
      SNAP,
      `sale-${uuidv4()}`,
    );

  const stockAlertsFor = (productId: string) =>
    ds.getRepository(AuditEntryEntity).find({
      where: { storeId: STORE, action: 'stock_adjustment', entityId: productId },
      order: { timestamp: 'ASC' },
    });

  const seedProduct = async (ean: string, stockQuantity: number) => {
    const id = uuidv4();
    await ds.getRepository(ProductEntity).save({
      id, storeId: STORE, ean, name: `P-${ean}`, priceMinorUnits: 500, taxRate: 20,
      stockQuantity, stockAlertThreshold: 5, stockCriticalThreshold: 2, isActive: true,
    } as any);
    return id;
  };

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        TypeOrmModule.forRoot({ type: 'postgres', url: TEST_DB, entities: loadAllEntities() as any, synchronize: true }),
        CacheModule, MessagingModule, RealtimeModule, TimewinModule, SalesModule, ReturnsModule,
      ],
    }).compile();
    ds = moduleRef.get(DataSource);
    sales = moduleRef.get(SalesService);
    await ds.getRepository(StoreEntity).save({ id: STORE, name: 'S', storeCode: 'S1', currencyCode: 'EUR', isActive: true } as any);
  });
  afterAll(async () => { await moduleRef?.close(); });

  it('a sale that crosses the LOW threshold writes a stock_adjustment alert (level=alert, source=pos_sale)', async () => {
    const pid = await seedProduct('7000000000011', 7); // above alert 5
    await sell('7000000000011', 3, 500); // 7 → 4 : crosses 5
    const alerts = await stockAlertsFor(pid);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].details).toMatchObject({
      level: 'alert', stockQuantity: 4, threshold: 5, source: 'pos_sale', ean: '7000000000011',
    });
  });

  it('a sale that crosses the CRITICAL threshold writes level=critical', async () => {
    const pid = await seedProduct('7000000000028', 3); // above critical 2, at/below alert 5 already
    await sell('7000000000028', 2, 500); // 3 → 1 : crosses critical 2
    const alerts = await stockAlertsFor(pid);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].details).toMatchObject({ level: 'critical', stockQuantity: 1, threshold: 2, source: 'pos_sale' });
  });

  it('a sale that stays ABOVE the threshold writes NO stock alert', async () => {
    const pid = await seedProduct('7000000000035', 100);
    await sell('7000000000035', 10, 500); // 100 → 90 : no crossing
    expect(await stockAlertsFor(pid)).toHaveLength(0);
  });

  it('EDGE-TRIGGERED — a second sale while already below does NOT re-alert', async () => {
    const pid = await seedProduct('7000000000042', 7);
    await sell('7000000000042', 3, 500); // 7 → 4 : crosses (1 alert)
    await sell('7000000000042', 1, 500); // 4 → 3 : already below, no new alert
    const alerts = await stockAlertsFor(pid);
    expect(alerts).toHaveLength(1); // still exactly one
    expect(alerts[0].details).toMatchObject({ level: 'alert' });
  });
});
