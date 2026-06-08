/**
 * Fiscal fix M2 — the sale hash fingerprint must bind ALL fiscal fields.
 *
 * v1 hashed only {ticketNumber, storeId, employeeId, total, items}, so TVA,
 * remise, paiements, horodatage and client could be altered without breaking
 * the chain. v2 binds them all and records `hashVersion` so existing v1 rows
 * are never rehashed.
 *
 * We assert on the FIRST sale of a fresh store (prevHash = genesis), so both
 * the legacy (v1) and the new (v2) fingerprints are fully reconstructible.
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

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
const GENESIS = '0'.repeat(64);

describe('Fiscal — M2 (sale hash fingerprint v2 binds all fiscal fields)', () => {
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

  it('M2 — première vente : version=2, empreinte v1 ≠ hash stocké, reconstruction v2 exacte', async () => {
    const dto = { items: [{ ean: '5000000000001', quantity: 1 }], payments: [{ method: 'cash', amountMinorUnits: 500 }] };
    const sale: any = await sales.createSale(STORE_ID, EMP_ID, dto as any, SNAP);

    // (1) la vente est marquée v2
    expect(sale.hashVersion).toBe(2);
    expect(sale.hashChainPrev).toBe(GENESIS); // première vente du magasin

    // (2) l'ANCIENNE empreinte v1 (champs partiels) ne reproduit PAS le hash stocké
    //     → preuve que des champs fiscaux supplémentaires sont désormais liés.
    const v1Payload = JSON.stringify({
      ticketNumber: sale.ticketNumber,
      storeId: STORE_ID,
      employeeId: EMP_ID,
      totalAfterDiscount: sale.totalMinorUnits,
      items: sale.lineItems.map((li: any) => ({ ean: li.ean, qty: li.quantity, total: li.lineTotalMinorUnits })),
    });
    expect(sha256(GENESIS + v1Payload)).not.toBe(sale.hashChainCurrent);

    // (3) la NOUVELLE empreinte v2 reconstruite à l'identique reproduit le hash stocké
    //     → un vérificateur peut re-dériver la chaîne. Reconstruit depuis les
    //     champs RENVOYÉS par la vente (pas de dépendance au calcul de TVA).
    const v2Payload = JSON.stringify({
      v: 2,
      ticketNumber: sale.ticketNumber,
      storeId: STORE_ID,
      employeeId: EMP_ID,
      customerId: sale.customerId ?? null,
      subtotalMinorUnits: sale.subtotalMinorUnits,
      discountTotalMinorUnits: sale.discountTotalMinorUnits,
      taxTotalMinorUnits: sale.taxTotalMinorUnits,
      totalAfterDiscount: sale.totalMinorUnits,
      payments: [{ method: 'cash', amount: 500 }],
      completedAt: new Date(sale.completedAt).toISOString(),
      items: sale.lineItems.map((li: any) => ({ ean: li.ean, qty: li.quantity, total: li.lineTotalMinorUnits })),
    });
    expect(sale.hashChainCurrent).toBe(sha256(GENESIS + v2Payload));

    // (4) le hash dépend de la TVA : altérer taxTotal change l'empreinte v2
    const tampered = v2Payload.replace(
      `"taxTotalMinorUnits":${sale.taxTotalMinorUnits}`,
      `"taxTotalMinorUnits":${sale.taxTotalMinorUnits + 1}`,
    );
    expect(tampered).not.toBe(v2Payload); // le champ est bien présent dans l'empreinte
    expect(sha256(GENESIS + tampered)).not.toBe(sale.hashChainCurrent);
  });
});
