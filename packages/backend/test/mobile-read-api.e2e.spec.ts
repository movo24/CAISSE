/**
 * Étage 1 — review gates (HTTP e2e). Boots a minimal Nest app for the mobile read
 * controller (JwtAuthGuard overridden to a fixed manager principal) and checks:
 *  #1 INV-1: a POST on a GET route is rejected by the framework (no mutating route).
 *  #2 404 indistinguishability: a forged out-of-scope :id and a genuinely-missing :id
 *     return the IDENTICAL status AND body (no existence leak).
 *  #3 computed_at present on all four endpoints.
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { createPgMemDataSource, loadAllEntities } from './helpers/pgmem';
import { JwtAuthGuard } from '../src/common/guards/jwt-auth.guard';
import { OrganizationEntity } from '../src/database/entities/organization.entity';
import { StoreEntity } from '../src/database/entities/store.entity';
import { EmployeeStoreAccessEntity } from '../src/database/entities/employee-store-access.entity';
import { AnalyticsStoreRegistryEntity } from '../src/database/entities/analytics-store-registry.entity';
import { AnalyticsStoreDailyEntity } from '../src/database/entities/analytics-store-daily.entity';
import { AnalyticsStoreSessionsEntity } from '../src/database/entities/analytics-store-sessions.entity';
import { AnalyticsStorePresenceEntity } from '../src/database/entities/analytics-store-presence.entity';
import { AnalyticsStoreStockEntity } from '../src/database/entities/analytics-store-stock.entity';
import { AnalyticsAlertEntity } from '../src/database/entities/analytics-alert.entity';
import { MobileReadController } from '../src/modules/mobile-read-api/mobile-read.controller';
import { MobileReadService } from '../src/modules/mobile-read-api/mobile-read.service';
import { StoreScopeResolverService } from '../src/modules/analytics-projection/store-scope-resolver.service';
import { ReadOnlyGuard } from '../src/modules/mobile-read-api/read-only.guard';

describe('Étage 1 — mobile read API review gates (HTTP)', () => {
  let app: INestApplication;
  let base: string;
  const ORG_A = uuidv4();
  const ORG_B = uuidv4();
  const S1 = uuidv4(); // manager home (in scope)
  const S4 = uuidv4(); // org B (real store, OUT of scope)
  const MISSING = uuidv4(); // never inserted anywhere
  const MANAGER = uuidv4();
  const today = new Date().toISOString().slice(0, 10);

  beforeAll(async () => {
    const { dataSource } = createPgMemDataSource();

    const moduleRef = await Test.createTestingModule({
      imports: [
        TypeOrmModule.forRootAsync({
          useFactory: () => ({ type: 'postgres', entities: loadAllEntities() as any, synchronize: true }),
          dataSourceFactory: async () => (dataSource.isInitialized ? dataSource : dataSource.initialize()),
        }),
        TypeOrmModule.forFeature([
          StoreEntity, EmployeeStoreAccessEntity,
          AnalyticsStoreRegistryEntity, AnalyticsStoreDailyEntity, AnalyticsStoreSessionsEntity,
          AnalyticsStorePresenceEntity, AnalyticsStoreStockEntity, AnalyticsAlertEntity,
        ]),
      ],
      controllers: [MobileReadController],
      providers: [MobileReadService, StoreScopeResolverService, ReadOnlyGuard],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate: (ctx: any) => {
          ctx.switchToHttp().getRequest().user = { employeeId: MANAGER, storeId: S1, role: 'manager' };
          return true;
        },
      })
      .compile();

    app = moduleRef.createNestApplication();
    await app.init();
    await app.listen(0);
    const ds = app.get(DataSource);
    const port = (app.getHttpServer().address() as any).port;
    base = `http://127.0.0.1:${port}`;

    await ds.getRepository(OrganizationEntity).save([{ id: ORG_A, name: 'Wesley' }, { id: ORG_B, name: 'Other' }] as any);
    await ds.getRepository(StoreEntity).save([
      { id: S1, name: 'B43', organizationId: ORG_A, isActive: true, currencyCode: 'EUR' },
      { id: S4, name: 'Évry', organizationId: ORG_B, isActive: true, currencyCode: 'EUR' },
    ] as any);
    const now = new Date();
    await ds.getRepository(AnalyticsStoreRegistryEntity).save([{ storeId: S1, name: 'B43', organizationId: ORG_A, unitId: null, isActive: true, computedAt: now }] as any);
    await ds.getRepository(AnalyticsStoreDailyEntity).save([{ storeId: S1, businessDay: today, caBrutMinor: 1500, txCount: 10, voidCount: 1, voidAmountMinor: 50, returnsAmountMinor: 200, netMinor: 1300, computedAt: now }] as any);
    await ds.getRepository(AnalyticsStoreSessionsEntity).save([{ storeId: S1, openSessions: 2, activeTerminals: 3, computedAt: now }] as any);
    await ds.getRepository(AnalyticsStorePresenceEntity).save([{ storeId: S1, presentCount: 4, expectedCount: 5, computedAt: now }] as any);
    await ds.getRepository(AnalyticsStoreStockEntity).save([{ storeId: S1, ruptureCount: 1, lowStockCount: 2, computedAt: now }] as any);
  });
  afterAll(async () => {
    await app?.close();
  });

  it('#1 INV-1 — POST on a GET route is rejected by the framework (no mutating route)', async () => {
    const res = await fetch(`${base}/mobile/v1/stores`, { method: 'POST' });
    expect([404, 405]).toContain(res.status); // no POST handler exists → framework/ReadOnlyGuard
  });

  it('#2 404 indistinguishability — forged out-of-scope :id ≡ genuinely-missing :id (same status AND body)', async () => {
    const forged = await fetch(`${base}/mobile/v1/stores/${S4}/live`);
    const missing = await fetch(`${base}/mobile/v1/stores/${MISSING}/live`);
    expect(forged.status).toBe(404);
    expect(missing.status).toBe(404);
    expect(await forged.json()).toEqual(await missing.json()); // identical body — no leak
  });

  it('#3 computed_at exposed on ALL four endpoints', async () => {
    const stores = await (await fetch(`${base}/mobile/v1/stores`)).json();
    expect(stores[0].computedAt).toBeTruthy();
    const overview = await (await fetch(`${base}/mobile/v1/dashboard/overview`)).json();
    expect(overview.computedAt).toBeTruthy();
    const live = await (await fetch(`${base}/mobile/v1/stores/${S1}/live`)).json();
    expect(live.computedAt).toBeTruthy();
    const perf = await (await fetch(`${base}/mobile/v1/stores/${S1}/performance`)).json();
    expect(perf.computedAt).toBeTruthy();
  });
});
