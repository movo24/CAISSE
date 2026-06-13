/**
 * Étage 2 — alerts engine SOCLE. The decisive tests:
 *  - GATE: a second evaluation on the SAME computed_at creates ZERO alerts (the
 *    engine's idempotence is anchored on the étage-0 computed_at monotonicity);
 *  - DEDUP (INV-6, structural): an ADVANCED computed_at re-firing the same
 *    (store, rule, day, band) is absorbed by the UNIQUE key → zero duplicates.
 * Uses a stub rule (zero real rules wired in the socle).
 */
import { DataSource } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { createPgMemDataSource } from './helpers/pgmem';
import { AnalyticsStoreRegistryEntity } from '../src/database/entities/analytics-store-registry.entity';
import { AnalyticsStoreClockEntity } from '../src/database/entities/analytics-store-clock.entity';
import { AnalyticsStoreDailyEntity } from '../src/database/entities/analytics-store-daily.entity';
import { AnalyticsStoreSessionsEntity } from '../src/database/entities/analytics-store-sessions.entity';
import { AnalyticsStorePresenceEntity } from '../src/database/entities/analytics-store-presence.entity';
import { AnalyticsStoreStockEntity } from '../src/database/entities/analytics-store-stock.entity';
import { AnalyticsAlertEntity } from '../src/database/entities/analytics-alert.entity';
import { AnalyticsAlertConfigEntity } from '../src/database/entities/analytics-alert-config.entity';
import { AnalyticsAlertCursorEntity } from '../src/database/entities/analytics-alert-cursor.entity';
import { AlertsEngineService } from '../src/modules/alerts-engine/alerts-engine.service';
import { AlertRule, AlertRuleContext, AlertFact } from '../src/modules/alerts-engine/alert-rule.interface';

class StubRule implements AlertRule {
  readonly name = 'stub_rule';
  calls = 0;
  async evaluate(ctx: AlertRuleContext): Promise<AlertFact[]> {
    this.calls++;
    return [{ rule: this.name, thresholdBand: 'band_a', businessDay: ctx.businessDay, payload: { v: 1 } }];
  }
}

describe('Étage 2 — alerts engine socle (gate + dedup)', () => {
  let ds: DataSource;
  let engine: AlertsEngineService;
  let stub: StubRule;
  const STORE = uuidv4();
  const NOW = new Date('2026-06-12T10:00:00Z');
  const T1 = new Date('2026-06-12T09:55:00Z');
  const T2 = new Date('2026-06-12T10:00:30Z');

  const alertCount = () => ds.getRepository(AnalyticsAlertEntity).count({ where: { storeId: STORE } });

  beforeAll(async () => {
    const { dataSource } = createPgMemDataSource();
    ds = dataSource.isInitialized ? dataSource : await dataSource.initialize();

    await ds.getRepository(AnalyticsStoreRegistryEntity).save({
      storeId: STORE, name: 'B43', organizationId: null, unitId: null, isActive: true, computedAt: T1,
    } as any);
    await ds.getRepository(AnalyticsStoreDailyEntity).save({
      storeId: STORE, businessDay: '2026-06-12', caBrutMinor: 1000, txCount: 5, computedAt: T1,
    } as any);

    stub = new StubRule();
    engine = new AlertsEngineService(
      ds.getRepository(AnalyticsStoreRegistryEntity),
      ds.getRepository(AnalyticsStoreDailyEntity),
      ds.getRepository(AnalyticsStoreSessionsEntity),
      ds.getRepository(AnalyticsStorePresenceEntity),
      ds.getRepository(AnalyticsStoreStockEntity),
      ds.getRepository(AnalyticsAlertEntity),
      ds.getRepository(AnalyticsAlertConfigEntity),
      ds.getRepository(AnalyticsAlertCursorEntity),
      ds.getRepository(AnalyticsStoreClockEntity),
      [stub],
    );
  });
  afterAll(async () => {
    await ds?.destroy();
  });

  it('pass 1 — fresh projection → the fact is persisted with payload + source computed_at', async () => {
    const r = await engine.evaluateStore(STORE, NOW);
    expect(r).toMatchObject({ gated: false, created: 1, deduped: 0 });
    const alert = await ds.getRepository(AnalyticsAlertEntity).findOne({ where: { storeId: STORE } });
    expect(alert!.rule).toBe('stub_rule');
    expect(alert!.thresholdBand).toBe('band_a');
    expect(alert!.payload).toEqual({ v: 1 });
    expect(new Date(alert!.computedAt).getTime()).toBe(T1.getTime());
  });

  it('DECISIVE GATE — re-evaluation on the SAME computed_at → gated, rule NOT run, zero alerts', async () => {
    const callsBefore = stub.calls;
    const r = await engine.evaluateStore(STORE, new Date(NOW.getTime() + 60_000));
    expect(r).toMatchObject({ gated: true, created: 0, deduped: 0 });
    expect(stub.calls).toBe(callsBefore); // the rule was never invoked
    expect(await alertCount()).toBe(1);
  });

  it('DECISIVE DEDUP (INV-6) — advanced computed_at, same (rule, day, band) → absorbed by the unique key', async () => {
    await ds.getRepository(AnalyticsStoreDailyEntity).update({ storeId: STORE, businessDay: '2026-06-12' }, { computedAt: T2 });
    const r = await engine.evaluateStore(STORE, new Date(NOW.getTime() + 120_000));
    expect(r).toMatchObject({ gated: false, created: 0, deduped: 1 });
    expect(await alertCount()).toBe(1); // still exactly one
  });

  it('evaluateAll iterates the REGISTRY projection (INV-2), not the source stores table', async () => {
    const results = await engine.evaluateAll(new Date(NOW.getTime() + 180_000));
    expect(results.map((r) => r.storeId)).toContain(STORE);
  });
});
