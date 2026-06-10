/**
 * Fiscal chain verifier — proves it (a) passes on clean data, (b) catches an
 * in-place field tamper (hash recompute mismatch), and (c) catches a linkage
 * tamper (pointer walk break). Uses real Sales/Returns services to produce the
 * chains, then mutates rows with raw SQL to simulate tampering.
 */
import './helpers/env-setup';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';

import { createPgMemDataSource, loadAllEntities } from './helpers/pgmem';
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

describe('Fiscal — chain verifier', () => {
  let moduleRef: TestingModule;
  let ds: DataSource;
  let sales: SalesService;
  let returns: ReturnsService;
  let verifier: FiscalVerifyService;
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
    returns = moduleRef.get(ReturnsService);
    verifier = new FiscalVerifyService(ds);

    await ds.getRepository(StoreEntity).save({ id: STORE_ID, name: 'S', storeCode: 'S1', currencyCode: 'EUR', isActive: true } as any);
    await ds.getRepository(ProductEntity).save({
      id: uuidv4(), storeId: STORE_ID, ean: '5000000000001', name: 'Article 5€',
      priceMinorUnits: 500, taxRate: 20, stockQuantity: 1000, stockAlertThreshold: 5, stockCriticalThreshold: 2, isActive: true,
    } as any);
  });

  afterAll(async () => { await moduleRef?.close(); });

  const freshStock = () => ds.getRepository(ProductEntity).update({ storeId: STORE_ID }, { stockQuantity: 1000 });
  async function sell(): Promise<any> {
    // Void is intentionally exercised on non-cash payments; realized cash legs
    // are covered by void-cash-realized-guard.spec.ts and must be reversed via
    // returns. The verifier tests are tender-agnostic — they check chain
    // linkage and recompute, not the payment method.
    await freshStock();
    const dto = { items: [{ ean: '5000000000001', quantity: 1 }], payments: [{ method: 'card', amountMinorUnits: 500 }] };
    return sales.createSale(STORE_ID, EMP_ID, dto as any, SNAP);
  }
  const get = (c: any[], name: string) => c.find((x) => x.chain === name);

  it('passe sur des données saines (ventes v2 + avoir + journal de void)', async () => {
    const s1 = await sell();
    await sell();
    await returns.issueGiftCard(STORE_ID, EMP_ID, { amountMinorUnits: 2000 }, 'Alice');
    await sales.voidSale(s1.id, EMP_ID, STORE_ID, 'admin'); // → 1 entrée fiscal_journal

    const report = await verifier.verify(STORE_ID);
    expect(report.ok).toBe(true);

    const salesC = get(report.chains, 'sales');
    expect(salesC.rows).toBe(2);
    expect(salesC.linkageOk).toBe(true);
    expect(salesC.recomputeOk).toBe(true);          // pg-mem round-trips exactly
    expect(salesC.recomputeAuthoritative).toBe(false);

    const cnC = get(report.chains, 'credit_notes');
    expect(cnC.linkageOk).toBe(true);
    expect(cnC.recomputeOk).toBe(true);

    const jC = get(report.chains, 'fiscal_journal');
    expect(jC.rows).toBe(1);
    expect(jC.linkageOk).toBe(true);
    expect(jC.recomputeOk).toBe(true);
    expect(jC.recomputeAuthoritative).toBe(true);    // payload stored verbatim
  });

  it('détecte un tamper de champ fiscal (TVA modifiée sans recalcul du hash)', async () => {
    const row = await ds.query(`SELECT id FROM sales WHERE store_id = $1 ORDER BY ticket_number ASC LIMIT 1`, [STORE_ID]);
    await ds.query(`UPDATE sales SET tax_total_minor_units = tax_total_minor_units + 100 WHERE id = $1`, [row[0].id]);

    const report = await verifier.verify(STORE_ID);
    const salesC = get(report.chains, 'sales');
    expect(salesC.recomputeOk).toBe(false);          // le hash ne se recalcule plus
    expect(salesC.issues.some((i: any) => i.kind === 'hash_mismatch')).toBe(true);
    expect(report.ok).toBe(false);
  });

  it('détecte une rupture de linkage (pointeur de chaîne falsifié)', async () => {
    await ds.query(
      `UPDATE fiscal_journal SET hash_chain_prev = $1 WHERE store_id = $2`,
      ['deadbeef'.repeat(8), STORE_ID], // 64 hex chars, mais ne pointe sur rien
    );
    const report = await verifier.verify(STORE_ID);
    const jC = get(report.chains, 'fiscal_journal');
    expect(jC.linkageOk).toBe(false);
    expect(jC.issues.some((i: any) => i.kind === 'orphan' || i.kind === 'no_genesis' || i.kind === 'unreachable')).toBe(true);
  });
});
