/**
 * Étage 3 — AiBriefService: the seam in action. DECISIVE INV-3: a narrator that
 * fabricates a number is REJECTED by the provenance guard and the deterministic
 * template is served instead — the fabrication is never served. Cache: same
 * computed_at → the narrator is NOT re-called; advanced computed_at → re-render.
 */
import { DataSource } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { createPgMemDataSource } from './helpers/pgmem';
import { AnalyticsStoreDailyEntity } from '../src/database/entities/analytics-store-daily.entity';
import { AnalyticsStoreSessionsEntity } from '../src/database/entities/analytics-store-sessions.entity';
import { AnalyticsStorePresenceEntity } from '../src/database/entities/analytics-store-presence.entity';
import { AnalyticsStoreStockEntity } from '../src/database/entities/analytics-store-stock.entity';
import { AnalyticsStoreRegistryEntity } from '../src/database/entities/analytics-store-registry.entity';
import { AnalyticsAlertEntity } from '../src/database/entities/analytics-alert.entity';
import { AnalyticsStoreTargetEntity } from '../src/database/entities/analytics-store-target.entity';
import { AnalyticsBriefEntity } from '../src/database/entities/analytics-brief.entity';
import { BriefFindingsService, BriefFindings } from '../src/modules/ai-brief/brief-findings.service';
import { BriefNarrator } from '../src/modules/ai-brief/brief-narrator.interface';
import { AiBriefService } from '../src/modules/ai-brief/ai-brief.service';

const DAY = '2026-06-12';
const T1 = new Date('2026-06-12T09:00:00Z');
const T2 = new Date('2026-06-12T09:10:00Z');

class ScriptedNarrator implements BriefNarrator {
  calls = 0;
  constructor(private readonly script: (f: BriefFindings) => string) {}
  async render(f: BriefFindings): Promise<string> {
    this.calls++;
    return this.script(f);
  }
}

describe('Étage 3 — AiBriefService (guard + fallback + cache)', () => {
  let ds: DataSource;
  let findings: BriefFindingsService;
  const STORE = uuidv4();

  const makeService = (narrator: BriefNarrator) =>
    new AiBriefService(findings, narrator, ds.getRepository(AnalyticsBriefEntity));

  beforeAll(async () => {
    const { dataSource } = createPgMemDataSource();
    ds = dataSource.isInitialized ? dataSource : await dataSource.initialize();
    await ds.getRepository(AnalyticsStoreRegistryEntity).save({
      storeId: STORE, name: 'B43', organizationId: null, unitId: null, isActive: true, computedAt: T1,
    } as any);
    await ds.getRepository(AnalyticsStoreDailyEntity).save({
      storeId: STORE, businessDay: DAY, caBrutMinor: 150000, netMinor: 150000, txCount: 42,
      voidCount: 0, voidAmountMinor: 0, returnsAmountMinor: 0, discountTotalMinor: 0, computedAt: T1,
    } as any);
    findings = new BriefFindingsService(
      ds.getRepository(AnalyticsStoreDailyEntity),
      ds.getRepository(AnalyticsStoreSessionsEntity),
      ds.getRepository(AnalyticsStorePresenceEntity),
      ds.getRepository(AnalyticsStoreStockEntity),
      ds.getRepository(AnalyticsStoreRegistryEntity),
      ds.getRepository(AnalyticsAlertEntity),
      ds.getRepository(AnalyticsStoreTargetEntity),
    );
  });
  afterAll(async () => {
    await ds?.destroy();
  });
  beforeEach(async () => {
    await ds.getRepository(AnalyticsBriefEntity).clear();
  });

  it('DECISIVE INV-3 — a fabricating narrator is REJECTED: the fallback is served, the fabrication never is', async () => {
    const liar = new ScriptedNarrator(() => 'Le CA explose à 9 999,99 € aujourd’hui !');
    const svc = makeService(liar);
    const r = await svc.getOrGenerate([STORE], DAY);
    expect(r.status).toBe('fallback'); // rejected → deterministic template
    expect(r.text).not.toContain('9 999,99'); // the fabricated number is NEVER served
    expect(r.text).toContain('1500,00'); // the real CA (150000 minor → euros), from the findings
    const persisted = await ds.getRepository(AnalyticsBriefEntity).findOne({ where: {} });
    expect(persisted!.status).toBe('fallback');
    expect(persisted!.text).not.toContain('9 999,99');
  });

  it('a faithful narrator is served as-is (status rendered)', async () => {
    const honest = new ScriptedNarrator((f) => `Belle journée : ${f.totals.txCount} tickets pour 1500,00 €.`);
    const svc = makeService(honest);
    const r = await svc.getOrGenerate([STORE], DAY);
    expect(r.status).toBe('rendered');
    expect(r.text).toContain('42 tickets');
    expect(r.computedAt).toBe(T1.toISOString());
  });

  it('CACHE — same computed_at → the narrator is NOT re-called; the persisted prose is stable', async () => {
    const honest = new ScriptedNarrator((f) => `Journée à ${f.totals.txCount} tickets.`);
    const svc = makeService(honest);
    await svc.getOrGenerate([STORE], DAY);
    expect(honest.calls).toBe(1);
    const again = await svc.getOrGenerate([STORE], DAY);
    expect(honest.calls).toBe(1); // gated by the computed_at anchor
    expect(again.status).toBe('rendered');
  });

  it('CACHE — advanced projection freshness → re-rendered once', async () => {
    const honest = new ScriptedNarrator((f) => `Journée à ${f.totals.txCount} tickets.`);
    const svc = makeService(honest);
    await svc.getOrGenerate([STORE], DAY);
    await ds.getRepository(AnalyticsStoreDailyEntity).update({ storeId: STORE, businessDay: DAY }, { computedAt: T2 });
    await svc.getOrGenerate([STORE], DAY);
    expect(honest.calls).toBe(2);
  });

  it('no projection data at all → status no_data, no text fabricated', async () => {
    const svc = makeService(new ScriptedNarrator(() => 'peu importe'));
    const r = await svc.getOrGenerate([uuidv4()], DAY);
    expect(r.status).toBe('no_data');
    expect(r.text).toBeNull();
  });
});
