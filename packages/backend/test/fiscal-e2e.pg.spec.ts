/**
 * Fiscal E2E on a REAL Postgres (gated on TEST_DATABASE_URL — skipped otherwise,
 * so the normal pg-mem suite is unaffected).
 *
 * Purpose: validate behaviours pg-mem cannot — notably whether the M2 v2 sale
 * fingerprint (which hashes `completedAt.toISOString()`) still RE-VERIFIES after
 * a real timestamp round-trip through Postgres, plus the chains end-to-end via
 * the read-only verifier.
 *
 *   TEST_DATABASE_URL=postgresql://user@localhost:5432/caisse_fiscal_e2e \
 *     npx jest --forceExit test/fiscal-e2e.pg.spec.ts
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
import { ReturnsService } from '../src/modules/returns/returns.service';
import { StoreEntity } from '../src/database/entities/store.entity';
import { ProductEntity } from '../src/database/entities/product.entity';
import { FiscalVerifyService } from '../src/modules/fiscal/fiscal-verify.service';

const TEST_DB = process.env.TEST_DATABASE_URL;
const d = TEST_DB ? describe : describe.skip;

d('Fiscal E2E (real Postgres)', () => {
  let moduleRef: TestingModule;
  let ds: DataSource;
  let sales: SalesService;
  let returns: ReturnsService;
  let verifier: FiscalVerifyService;
  const STORE_ID = uuidv4();
  const EMP_ID = uuidv4();
  const SNAP = { employeeName: 'Alice', employeeRole: 'admin', maxDiscount: 100 };

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        TypeOrmModule.forRoot({
          type: 'postgres', url: TEST_DB, entities: loadAllEntities() as any, synchronize: true,
        }),
        CacheModule, MessagingModule, RealtimeModule, TimewinModule, SalesModule, ReturnsModule,
      ],
    }).compile();
    ds = moduleRef.get(DataSource);
    sales = moduleRef.get(SalesService);
    returns = moduleRef.get(ReturnsService);
    verifier = new FiscalVerifyService(ds);

    await ds.query(
      `TRUNCATE sales, sale_line_items, sale_payments, credit_notes, credit_note_lines,
                fiscal_journal, credit_note_redemptions, idempotency_keys RESTART IDENTITY CASCADE`,
    );
    await ds.getRepository(StoreEntity).save({ id: STORE_ID, name: 'S', storeCode: 'E2E', currencyCode: 'EUR', isActive: true } as any);
    await ds.getRepository(ProductEntity).save({
      id: uuidv4(), storeId: STORE_ID, ean: '5000000000001', name: 'Article 5€',
      priceMinorUnits: 500, taxRate: 20, stockQuantity: 1000, stockAlertThreshold: 5, stockCriticalThreshold: 2, isActive: true,
    } as any);
  });

  afterAll(async () => { await moduleRef?.close(); });

  it('exécute les flux fiscaux réels puis le vérificateur passe (round-trip PG inclus)', async () => {
    // vente simple, vente multi-lignes, carte cadeau, annulation
    const s1: any = await sales.createSale(STORE_ID, EMP_ID, { items: [{ ean: '5000000000001', quantity: 1 }], payments: [{ method: 'cash', amountMinorUnits: 500 }] } as any, SNAP);
    await sales.createSale(STORE_ID, EMP_ID, { items: [{ ean: '5000000000001', quantity: 3 }], payments: [{ method: 'card', amountMinorUnits: 1500 }] } as any, SNAP);
    await returns.issueGiftCard(STORE_ID, EMP_ID, { amountMinorUnits: 2000 }, 'Alice');
    await sales.voidSale(s1.id, EMP_ID, STORE_ID, 'admin');

    const report = await verifier.verify(STORE_ID);
    // log complet pour diagnostic (visible dans la sortie jest)
    // eslint-disable-next-line no-console
    console.log('E2E VERIFY REPORT:', JSON.stringify(report, null, 2));

    const sC = report.chains.find((c) => c.chain === 'sales')!;
    const jC = report.chains.find((c) => c.chain === 'fiscal_journal')!;

    // Linkage doit TOUJOURS tenir (robuste, indépendant des timestamps)
    expect(sC.linkageOk).toBe(true);
    expect(jC.linkageOk).toBe(true);
    // Journal: recompute autoritatif (payload stocké verbatim) doit passer
    expect(jC.recomputeOk).toBe(true);
    // Le point décisif M2 : le hash v2 se recalcule-t-il après round-trip PG réel ?
    expect(sC.recomputeOk).toBe(true);
    expect(report.ok).toBe(true);
  });
});
