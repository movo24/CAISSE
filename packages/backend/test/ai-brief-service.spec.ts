/**
 * Étage 3 — AiBriefService on SCHEDULED BEATS (ratified). The decisive semantics:
 *  - a beat that fails (guard rejection) persists the TEMPLATE and HOLDS it until
 *    the next beat — a healthy narrator in the SAME beat is NOT called (no retry);
 *  - stable between beats: re-requests within a beat never re-render, EVEN when
 *    the projection's computed_at advances (beats supersede the 5-min anchor);
 *  - before the day's first beat, the latest persisted brief stays served
 *    (stable overnight). Clock = analytics.store_clock (UTC stand-in).
 */
import { DataSource, IsNull } from 'typeorm';
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
import { AnalyticsStoreClockEntity } from '../src/database/entities/analytics-store-clock.entity';
import { BriefFindingsService, BriefFindings } from '../src/modules/ai-brief/brief-findings.service';
import { BriefNarrator } from '../src/modules/ai-brief/brief-narrator.interface';
import { AiBriefService } from '../src/modules/ai-brief/ai-brief.service';

const DAY = '2026-06-12';
const at = (h: number, m = 0, day = DAY) => new Date(`${day}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00Z`);
const T1 = at(9, 0);

class ScriptedNarrator implements BriefNarrator {
  calls = 0;
  constructor(private readonly script: (f: BriefFindings) => string) {}
  async render(f: BriefFindings): Promise<string> {
    this.calls++;
    return this.script(f);
  }
}
const honestScript = (f: BriefFindings) => `Journée à ${f.totals.txCount} tickets pour 1500,00 €.`;

describe('Étage 3 — AiBriefService (beats + guard + hold-until-next-beat)', () => {
  let ds: DataSource;
  let findings: BriefFindingsService;
  const STORE = uuidv4();

  const makeService = (narrator: BriefNarrator) =>
    new AiBriefService(findings, narrator, ds.getRepository(AnalyticsBriefEntity), ds.getRepository(AnalyticsStoreClockEntity));

  beforeAll(async () => {
    const { dataSource } = createPgMemDataSource();
    ds = dataSource.isInitialized ? dataSource : await dataSource.initialize();
    // The single wall-clock datum (UTC stand-in): beats 10/15 + close 20.
    await ds.getRepository(AnalyticsStoreClockEntity).save({
      storeId: null, timezone: 'Etc/UTC', briefBeatHours: [10, 15], closeHour: 20, isActive: true,
    } as any);
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

  it('DECISIVE INV-3 + COROLLARY — a rejected beat persists the template and HOLDS it: a healthy narrator in the same beat is NOT called; the NEXT beat re-renders', async () => {
    // Beat 10 (13:00): the narrator fabricates → guard rejects → template persisted.
    const liar = new ScriptedNarrator(() => 'Le CA explose à 9 999,99 € aujourd’hui !');
    const r1 = await makeService(liar).getOrGenerate([STORE], at(13));
    expect(r1).toMatchObject({ status: 'fallback', beat: 10 });
    expect(r1.text).not.toContain('9 999,99'); // the fabrication is NEVER served
    expect(r1.text).toContain('1500,00');

    // SAME beat (14:00), narrator now healthy → the fallback is HELD, no retry.
    const honest = new ScriptedNarrator(honestScript);
    const r2 = await makeService(honest).getOrGenerate([STORE], at(14));
    expect(honest.calls).toBe(0); // not even called — the hold is structural (the beat key)
    expect(r2).toMatchObject({ status: 'fallback', beat: 10 });
    expect(r2.text).toBe(r1.text);

    // NEXT beat (16:00 → beat 15): one fresh render.
    const r3 = await makeService(honest).getOrGenerate([STORE], at(16));
    expect(honest.calls).toBe(1);
    expect(r3).toMatchObject({ status: 'rendered', beat: 15 });
    expect(r3.text).toContain('42');
  });

  it('DECISIVE — stable BETWEEN beats: re-requests never re-render, even when computed_at advances', async () => {
    const honest = new ScriptedNarrator(honestScript);
    const svc = makeService(honest);
    const r1 = await svc.getOrGenerate([STORE], at(13));
    expect(r1).toMatchObject({ status: 'rendered', beat: 10 });
    expect(honest.calls).toBe(1);

    // The projection refreshes (computed_at advances) — the beat does NOT care.
    await ds.getRepository(AnalyticsStoreDailyEntity).update(
      { storeId: STORE, businessDay: DAY },
      { computedAt: at(13, 30) },
    );
    const r2 = await svc.getOrGenerate([STORE], at(14, 45));
    expect(honest.calls).toBe(1); // still one render — the prose does not move between beats
    expect(r2.text).toBe(r1.text);
  });

  it('before the first beat, the latest persisted brief stays served (stable overnight)', async () => {
    const honest = new ScriptedNarrator(honestScript);
    const svc = makeService(honest);
    // Close beat of day D (21:00 → beat 20).
    const close = await svc.getOrGenerate([STORE], at(21));
    expect(close).toMatchObject({ status: 'rendered', beat: 20 });

    // Next day 08:00 (no beat passed yet) → yesterday's close is served, nothing generated.
    const morning = await svc.getOrGenerate([STORE], at(8, 0, '2026-06-13'));
    expect(honest.calls).toBe(1); // no new render
    expect(morning).toMatchObject({ businessDay: DAY, beat: 20, status: 'rendered' });
    expect(morning.text).toBe(close.text);
  });

  it('awaiting_first_beat — fresh scope before any beat, nothing persisted → honest empty state', async () => {
    const r = await makeService(new ScriptedNarrator(honestScript)).getOrGenerate([uuidv4()], at(8));
    expect(r.status).toBe('awaiting_first_beat');
    expect(r.text).toBeNull();
    expect(r.beat).toBeNull();
  });

  it('no projection data at a beat → status no_data, nothing fabricated nor persisted', async () => {
    const r = await makeService(new ScriptedNarrator(() => 'peu importe')).getOrGenerate([uuidv4()], at(13));
    expect(r).toMatchObject({ status: 'no_data', beat: 10 });
    expect(r.text).toBeNull();
    expect(await ds.getRepository(AnalyticsBriefEntity).count()).toBe(0);
  });

  describe('A1 — beats + business day in LOCAL wall-clock (Europe/Paris)', () => {
    const PSTORE = uuidv4();

    beforeAll(async () => {
      const clock = await ds.getRepository(AnalyticsStoreClockEntity).findOne({ where: { storeId: IsNull() } });
      clock!.timezone = 'Europe/Paris';
      clock!.briefBeatHours = [12, 17];
      clock!.closeHour = 20;
      await ds.getRepository(AnalyticsStoreClockEntity).save(clock!);
      await ds.getRepository(AnalyticsStoreRegistryEntity).save({
        storeId: PSTORE, name: 'B43', organizationId: null, unitId: null, isActive: true, computedAt: new Date('2026-06-20T09:00:00Z'),
      } as any);
      await ds.getRepository(AnalyticsStoreDailyEntity).save({
        storeId: PSTORE, businessDay: '2026-06-20', caBrutMinor: 150000, netMinor: 150000, txCount: 42,
        voidCount: 0, voidAmountMinor: 0, returnsAmountMinor: 0, discountTotalMinor: 0, computedAt: new Date('2026-06-20T09:00:00Z'),
      } as any);
    });
    afterAll(async () => {
      const clock = await ds.getRepository(AnalyticsStoreClockEntity).findOne({ where: { storeId: IsNull() } });
      clock!.timezone = 'Etc/UTC';
      clock!.briefBeatHours = [10, 15];
      clock!.closeHour = 20;
      await ds.getRepository(AnalyticsStoreClockEntity).save(clock!);
    });

    it('DECISIVE — the midday beat passes by LOCAL hour: 11:30Z = 13:30 Paris → beat 12 (UTC hour 11 would have said none)', async () => {
      const honest = new ScriptedNarrator(honestScript);
      const r = await makeService(honest).getOrGenerate([PSTORE], new Date('2026-06-20T11:30:00Z'));
      expect(r).toMatchObject({ status: 'rendered', beat: 12, businessDay: '2026-06-20' });
      expect(honest.calls).toBe(1);
    });

    it('the business day rolls over at LOCAL midnight: 22:30Z = 00:30 Paris next day → pre-first-beat, yesterday’s brief stays served', async () => {
      const honest = new ScriptedNarrator(honestScript);
      const svc = makeService(honest);
      const dayBrief = await svc.getOrGenerate([PSTORE], new Date('2026-06-20T13:00:00Z')); // beat 12, persisted
      expect(dayBrief).toMatchObject({ status: 'rendered', beat: 12 });

      const r = await svc.getOrGenerate([PSTORE], new Date('2026-06-20T22:30:00Z')); // 00:30 Paris, day 06-21
      expect(honest.calls).toBe(1); // nothing NEW generated at 00:30 local
      expect(r).toMatchObject({ businessDay: '2026-06-20', beat: 12 }); // the previous local day's brief
      expect(r.text).toBe(dayBrief.text);
    });
  });
});
