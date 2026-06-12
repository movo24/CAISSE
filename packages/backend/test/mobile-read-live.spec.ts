/**
 * Étage 1 — GET /mobile/v1/stores/:id/live (resource). Happy path: live state of an
 * in-scope store from analytics.*. Decisive: a FORGED :id outside the scope → 404 +
 * a server-side WARN (anti-enumeration; the forge attempt is the audit signal).
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
import { AnalyticsAlertEntity } from '../src/database/entities/analytics-alert.entity';
import { AnalyticsStoreTargetEntity } from '../src/database/entities/analytics-store-target.entity';
import { StoreScopeResolverService } from '../src/modules/analytics-projection/store-scope-resolver.service';
import { MobileReadService } from '../src/modules/mobile-read-api/mobile-read.service';
import { MobileReadController } from '../src/modules/mobile-read-api/mobile-read.controller';

describe('Étage 1 — GET /mobile/v1/stores/:id/live (resource, 404+log out of scope)', () => {
  let ds: DataSource;
  let controller: MobileReadController;
  const ORG_A = uuidv4();
  const ORG_B = uuidv4();
  const S1 = uuidv4(); // manager home (org A, in scope)
  const S4 = uuidv4(); // org B (out of scope — a real store the manager must not see)
  const MANAGER = uuidv4();
  const now = new Date('2026-06-12T09:00:00Z');

  beforeAll(async () => {
    const { dataSource } = createPgMemDataSource();
    ds = dataSource.isInitialized ? dataSource : await dataSource.initialize();
    await ds.getRepository(OrganizationEntity).save([{ id: ORG_A, name: 'Wesley' }, { id: ORG_B, name: 'Other' }] as any);
    await ds.getRepository(StoreEntity).save([
      { id: S1, name: 'B43', organizationId: ORG_A, isActive: true, currencyCode: 'EUR' },
      { id: S4, name: 'Évry', organizationId: ORG_B, isActive: true, currencyCode: 'EUR' },
    ] as any);
    await ds.getRepository(AnalyticsStoreRegistryEntity).save([{ storeId: S1, name: 'B43', organizationId: ORG_A, unitId: null, isActive: true, computedAt: now }] as any);
    await ds.getRepository(AnalyticsStoreSessionsEntity).save([{ storeId: S1, openSessions: 2, activeTerminals: 3, computedAt: now }] as any);
    await ds.getRepository(AnalyticsStorePresenceEntity).save([{ storeId: S1, presentCount: 4, expectedCount: 5, computedAt: now }] as any);
    await ds.getRepository(AnalyticsStoreStockEntity).save([{ storeId: S1, ruptureCount: 1, lowStockCount: 2, computedAt: now }] as any);

    const resolver = new StoreScopeResolverService(ds.getRepository(StoreEntity), ds.getRepository(EmployeeStoreAccessEntity));
    const service = new MobileReadService(
      ds.getRepository(AnalyticsStoreRegistryEntity),
      ds.getRepository(AnalyticsStoreDailyEntity),
      ds.getRepository(AnalyticsStoreSessionsEntity),
      ds.getRepository(AnalyticsStorePresenceEntity),
      ds.getRepository(AnalyticsStoreStockEntity),
      ds.getRepository(AnalyticsAlertEntity),
      ds.getRepository(AnalyticsStoreTargetEntity),
    );
    controller = new MobileReadController(resolver, service);
  });
  afterAll(async () => {
    await ds?.destroy();
  });

  it('happy path — live state of an in-scope store, with computed_at', async () => {
    const live = await controller.live(S1, { user: { employeeId: MANAGER, storeId: S1, role: 'manager' } });
    expect(live.storeId).toBe(S1);
    expect(live.sessions.activeTerminals).toBe(3);
    expect(live.presence.presentCount).toBe(4);
    expect(live.stock.ruptureCount).toBe(1);
    expect(live.computedAt).toBeTruthy();
  });

  it('DECISIVE — a forged :id outside the scope → 404 + a server WARN', async () => {
    const warnSpy = jest.spyOn((controller as any).logger, 'warn').mockImplementation(() => undefined);
    await expect(
      controller.live(S4, { user: { employeeId: MANAGER, storeId: S1, role: 'manager' } }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(warnSpy).toHaveBeenCalled(); // the forge attempt is logged (audit)
    warnSpy.mockRestore();
  });
});
