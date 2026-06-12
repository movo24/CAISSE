/**
 * Étage 3 closure — GET /mobile/v1/ai-brief (collection rule, silently scoped).
 * The brief is built from the caller's scope only; computed_at exposed; the text
 * is the provenance-verified output.
 */
import { DataSource } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { createPgMemDataSource } from './helpers/pgmem';
import { OrganizationEntity } from '../src/database/entities/organization.entity';
import { StoreEntity } from '../src/database/entities/store.entity';
import { EmployeeStoreAccessEntity } from '../src/database/entities/employee-store-access.entity';
import { AnalyticsStoreDailyEntity } from '../src/database/entities/analytics-store-daily.entity';
import { AnalyticsStoreSessionsEntity } from '../src/database/entities/analytics-store-sessions.entity';
import { AnalyticsStorePresenceEntity } from '../src/database/entities/analytics-store-presence.entity';
import { AnalyticsStoreStockEntity } from '../src/database/entities/analytics-store-stock.entity';
import { AnalyticsStoreRegistryEntity } from '../src/database/entities/analytics-store-registry.entity';
import { AnalyticsAlertEntity } from '../src/database/entities/analytics-alert.entity';
import { AnalyticsStoreTargetEntity } from '../src/database/entities/analytics-store-target.entity';
import { AnalyticsBriefEntity } from '../src/database/entities/analytics-brief.entity';
import { StoreScopeResolverService } from '../src/modules/analytics-projection/store-scope-resolver.service';
import { BriefFindingsService } from '../src/modules/ai-brief/brief-findings.service';
import { TemplateBriefNarrator } from '../src/modules/ai-brief/brief-narrator.interface';
import { AiBriefService } from '../src/modules/ai-brief/ai-brief.service';
import { AiBriefController } from '../src/modules/ai-brief/ai-brief.controller';

describe('Étage 3 — GET /mobile/v1/ai-brief (scoped brief)', () => {
  let ds: DataSource;
  let controller: AiBriefController;
  const ORG_A = uuidv4();
  const ORG_B = uuidv4();
  const S1 = uuidv4();
  const S4 = uuidv4(); // other org — must never leak into the brief
  const MANAGER = uuidv4();
  const today = new Date().toISOString().slice(0, 10);
  const now = new Date();

  beforeAll(async () => {
    const { dataSource } = createPgMemDataSource();
    ds = dataSource.isInitialized ? dataSource : await dataSource.initialize();
    await ds.getRepository(OrganizationEntity).save([{ id: ORG_A, name: 'Wesley' }, { id: ORG_B, name: 'Other' }] as any);
    await ds.getRepository(StoreEntity).save([
      { id: S1, name: 'B43', organizationId: ORG_A, isActive: true, currencyCode: 'EUR' },
      { id: S4, name: 'Évry', organizationId: ORG_B, isActive: true, currencyCode: 'EUR' },
    ] as any);
    await ds.getRepository(AnalyticsStoreRegistryEntity).save([
      { storeId: S1, name: 'B43', organizationId: ORG_A, unitId: null, isActive: true, computedAt: now },
      { storeId: S4, name: 'Évry', organizationId: ORG_B, unitId: null, isActive: true, computedAt: now },
    ] as any);
    await ds.getRepository(AnalyticsStoreDailyEntity).save([
      { storeId: S1, businessDay: today, caBrutMinor: 150000, netMinor: 150000, txCount: 42, voidCount: 0, voidAmountMinor: 0, returnsAmountMinor: 0, discountTotalMinor: 0, computedAt: now },
      { storeId: S4, businessDay: today, caBrutMinor: 777700, netMinor: 777700, txCount: 99, voidCount: 0, voidAmountMinor: 0, returnsAmountMinor: 0, discountTotalMinor: 0, computedAt: now },
    ] as any);

    const findings = new BriefFindingsService(
      ds.getRepository(AnalyticsStoreDailyEntity),
      ds.getRepository(AnalyticsStoreSessionsEntity),
      ds.getRepository(AnalyticsStorePresenceEntity),
      ds.getRepository(AnalyticsStoreStockEntity),
      ds.getRepository(AnalyticsStoreRegistryEntity),
      ds.getRepository(AnalyticsAlertEntity),
      ds.getRepository(AnalyticsStoreTargetEntity),
    );
    const service = new AiBriefService(findings, new TemplateBriefNarrator(), ds.getRepository(AnalyticsBriefEntity));
    const resolver = new StoreScopeResolverService(ds.getRepository(StoreEntity), ds.getRepository(EmployeeStoreAccessEntity));
    controller = new AiBriefController(resolver, service);
  });
  afterAll(async () => {
    await ds?.destroy();
  });

  it('the brief is built from the manager’s scope ONLY — the other org’s figures never appear', async () => {
    const r = await controller.brief({ user: { employeeId: MANAGER, storeId: S1, role: 'manager' } });
    expect(r.status).toBe('rendered');
    expect(r.text).toContain('1500,00'); // S1's CA (150000 minor)
    expect(r.text).toContain('42');
    expect(r.text).not.toContain('7777'); // S4's CA never leaks (silent scope shaping)
    expect(r.text).not.toContain('Évry');
    expect(r.computedAt).toBeTruthy(); // freshness exposed
  });
});
