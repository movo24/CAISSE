/**
 * Fiscal fix M4 — an annulation (void) must be a chained, tamper-evident event
 * in an append-only fiscal journal, not merely a `sales.status='voided'` flip +
 * audit line.
 *
 * We assert that voiding a sale writes one `fiscal_journal` row, hash-chained
 * per store (genesis → link → link), self-consistent (current == sha256(prev +
 * payload)), and that the original sale stays immutable.
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
import { CacheModule } from '../src/common/cache/cache.module';
import { MessagingModule } from '../src/common/messaging/messaging.module';
import { RealtimeModule } from '../src/common/realtime/realtime.module';
import { TimewinModule } from '../src/modules/timewin/timewin.module';
import { SalesService } from '../src/modules/sales/sales.service';
import { StoreEntity } from '../src/database/entities/store.entity';
import { ProductEntity } from '../src/database/entities/product.entity';
import { FiscalJournalEntity } from '../src/database/entities/fiscal-journal.entity';

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
const GENESIS = '0'.repeat(64);

describe('Fiscal — M4 (void chained into append-only fiscal journal)', () => {
  let moduleRef: TestingModule;
  let ds: DataSource;
  let sales: SalesService;
  const STORE_ID = uuidv4();
  const EMP_ID = uuidv4();
  const SNAP = { employeeName: 'Alice', employeeRole: 'admin', maxDiscount: 100 };

  beforeAll(async () => {
    const { dataSource } = createPgMemDataSource();
    moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        TypeOrmModule.forRootAsync({
          useFactory: () => ({ type: 'postgres', entities: loadAllEntities() as any, synchronize: true }),
          dataSourceFactory: async () => (dataSource.isInitialized ? dataSource : dataSource.initialize()),
        }),
        CacheModule, MessagingModule, RealtimeModule, TimewinModule, SalesModule, ReturnsModule,
      ],
    }).compile();
    ds = moduleRef.get(DataSource);
    sales = moduleRef.get(SalesService);

    await ds.getRepository(StoreEntity).save({ id: STORE_ID, name: 'S', storeCode: 'S1', currencyCode: 'EUR', isActive: true } as any);
    await ds.getRepository(ProductEntity).save({
      id: uuidv4(), storeId: STORE_ID, ean: '5000000000001', name: 'Article 5€',
      priceMinorUnits: 500, taxRate: 20, stockQuantity: 1000, stockAlertThreshold: 5, stockCriticalThreshold: 2, isActive: true,
    } as any);
  });

  afterAll(async () => { await moduleRef?.close(); });

  // pg-mem mis-types GREATEST(0, stock-$1); replenish before each sale.
  const freshStock = () => ds.getRepository(ProductEntity).update({ storeId: STORE_ID }, { stockQuantity: 1000 });
  const journalRepo = () => ds.getRepository(FiscalJournalEntity);

  async function sellAndVoid(): Promise<any> {
    // Void is intentionally exercised on non-cash payments; realized cash legs
    // are covered by void-cash-realized-guard.spec.ts and must be reversed via
    // returns. The journal-chain invariant under test is tender-agnostic.
    await freshStock();
    const dto = { items: [{ ean: '5000000000001', quantity: 1 }], payments: [{ method: 'card', amountMinorUnits: 500 }] };
    const sale: any = await sales.createSale(STORE_ID, EMP_ID, dto as any, SNAP);
    await sales.voidSale(sale.id, EMP_ID, STORE_ID, 'admin');
    return sale;
  }

  it('M4 — un void écrit un maillon de journal, auto-cohérent et chaîné depuis le genesis', async () => {
    const sale = await sellAndVoid();

    const rows = await journalRepo().find({ where: { storeId: STORE_ID } });
    const entry: any = rows.find((r) => r.refId === sale.id);
    expect(entry).toBeTruthy();
    expect(entry.eventType).toBe('void');
    expect(entry.ticketNumber).toBe(sale.ticketNumber);

    // self-consistent: current == sha256(prev + payload)
    expect(entry.hashChainCurrent).toBe(sha256(entry.hashChainPrev + entry.payload));
    // first event in this store → chained on genesis
    expect(entry.hashChainPrev).toBe(GENESIS);

    const payload = JSON.parse(entry.payload);
    expect(payload.type).toBe('void');
    expect(payload.saleId).toBe(sale.id);
    expect(payload).toHaveProperty('avoirRestoredMinorUnits');
    expect(payload).toHaveProperty('voidedAt');
  });

  it('M4 — un second void chaîne sur le premier (pas de fork)', async () => {
    const sale2 = await sellAndVoid();

    const rows = await journalRepo().find({ where: { storeId: STORE_ID } });
    expect(rows.length).toBeGreaterThanOrEqual(2);

    const second: any = rows.find((r) => r.refId === sale2.id);
    expect(second).toBeTruthy();
    // its prev must equal some existing entry's current (it links into the chain, not genesis)
    expect(second.hashChainPrev).not.toBe(GENESIS);
    const linksToKnown = rows.some((r: any) => r.hashChainCurrent === second.hashChainPrev);
    expect(linksToKnown).toBe(true);
    expect(second.hashChainCurrent).toBe(sha256(second.hashChainPrev + second.payload));
  });

  it('M4 — la vente d’origine reste immuable (hash inchangé)', async () => {
    await freshStock();
    // Void is intentionally exercised on non-cash payments (see sellAndVoid above).
    const dto = { items: [{ ean: '5000000000001', quantity: 1 }], payments: [{ method: 'card', amountMinorUnits: 500 }] };
    const sale: any = await sales.createSale(STORE_ID, EMP_ID, dto as any, SNAP);
    const beforeHash = sale.hashChainCurrent;
    const voided: any = await sales.voidSale(sale.id, EMP_ID, STORE_ID, 'admin');
    expect(voided.status).toBe('voided');
    expect(voided.hashChainCurrent).toBe(beforeHash); // sale's own chain untouched
  });
});
