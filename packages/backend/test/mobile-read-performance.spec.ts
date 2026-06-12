/**
 * Étage 1 — GET /mobile/v1/stores/:id/performance (resource). Happy path: CA / tickets
 * / average basket of an in-scope store from analytics.store_daily. Decisive: a forged
 * out-of-scope :id → 404 + a server WARN.
 */
import { NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { createPgMemDataSource } from './helpers/pgmem';
import { OrganizationEntity } from '../src/database/entities/organization.entity';
import { StoreEntity } from '../src/database/entities/store.entity';
import { EmployeeStoreAccessEntity } from '../src/database/entities/employee-store-access.entity';
import { AnalyticsStoreRegistryEntity } from '../src/database/entities/analytics-store-registry.entity';
import { AnalyticsStoreDailyEntity } from '../src/database/entities/analytics-store-daily.entity';
import { AnalyticsStoreSessionsEntity } from '../src/database/entities/analytics-store-sessions.entity';
import { AnalyticsStorePresenceEntity } from '../src/database/entities/analytics-store-presence.entity';
import { AnalyticsStoreStockEntity } from '../src/database/entities/analytics-store-stock.entity';
import { StoreScopeResolverService } from '../src/modules/analytics-projection/store-scope-resolver.service';
import { MobileReadService } from '../src/modules/mobile-read-api/mobile-read.service';
import { MobileReadController } from '../src/modules/mobile-read-api/mobile-read.controller';

describe('Étage 1 — GET /mobile/v1/stores/:id/performance (resource, 404+log)', () => {
  let ds: DataSource;
  let controller: MobileReadController;
  const ORG_A = uuidv4();
  const ORG_B = uuidv4();
  const S1 = uuidv4();
  const S4 = uuidv4();
  const MANAGER = uuidv4();
  const today = new Date().toISOString().slice(0, 10);

  beforeAll(async () => {
    const { dataSource } = createPgMemDataSource();
    ds = dataSource.isInitialized ? dataSource : await dataSource.initialize();
    await ds.getRepository(OrganizationEntity).save([{ id: ORG_A, name: 'Wesley' }, { id: ORG_B, name: 'Other' }] as any);
    await ds.getRepository(StoreEntity).save([
      { id: S1, name: 'B43', organizationId: ORG_A, isActive: true, currencyCode: 'EUR' },
      { id: S4, name: 'Évry', organizationId: ORG_B, isActive: true, currencyCode: 'EUR' },
    ] as any);
    await ds.getRepository(AnalyticsStoreDailyEntity).save([
      { storeId: S1, businessDay: today, caBrutMinor: 1500, txCount: 10, voidCount: 1, voidAmountMinor: 50, returnsAmountMinor: 200, netMinor: 1300, computedAt: new Date() },
    ] as any);

    const resolver = new StoreScopeResolverService(ds.getRepository(StoreEntity), ds.getRepository(EmployeeStoreAccessEntity));
    const service = new MobileReadService(
      ds.getRepository(AnalyticsStoreRegistryEntity),
      ds.getRepository(AnalyticsStoreDailyEntity),
      ds.getRepository(AnalyticsStoreSessionsEntity),
      ds.getRepository(AnalyticsStorePresenceEntity),
      ds.getRepository(AnalyticsStoreStockEntity),
    );
    controller = new MobileReadController(resolver, service);
  });
  afterAll(async () => {
    await ds?.destroy();
  });

  it('happy path — CA / tickets / average basket of an in-scope store, with computed_at', async () => {
    const p = await controller.performance(S1, { user: { employeeId: MANAGER, storeId: S1, role: 'manager' } });
    expect(p.storeId).toBe(S1);
    expect(p.caBrutMinor).toBe(1500);
    expect(p.txCount).toBe(10);
    expect(p.avgBasketMinor).toBe(150); // 1500 / 10
    expect(p.netMinor).toBe(1300);
    expect(p.computedAt).toBeTruthy();
  });

  it('DECISIVE — a forged :id outside the scope → 404 + a server WARN', async () => {
    const warnSpy = jest.spyOn((controller as any).logger, 'warn').mockImplementation(() => undefined);
    await expect(
      controller.performance(S4, { user: { employeeId: MANAGER, storeId: S1, role: 'manager' } }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});
