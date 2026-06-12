/**
 * Étage 0 — presence projection refresh (INV-4). Presence is owned by TimeWin24;
 * the job snapshots it via the proxy (no local attendance table). Tests the
 * defensive shape extraction + the snapshot + outage resilience.
 */
import { DataSource } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { createPgMemDataSource } from './helpers/pgmem';
import { OrganizationEntity } from '../src/database/entities/organization.entity';
import { StoreEntity } from '../src/database/entities/store.entity';
import { AnalyticsStorePresenceEntity } from '../src/database/entities/analytics-store-presence.entity';
import {
  PresenceProjectionRefreshService,
  extractPresence,
} from '../src/modules/analytics-projection/presence-projection-refresh.service';

describe('Étage 0 — extractPresence (defensive shape)', () => {
  it('counts present vs expected from a { shifts: [...] } shape', () => {
    expect(extractPresence({ shifts: [{ status: 'present' }, { status: 'absent' }, { clockInAt: '08:00' }] })).toEqual({ present: 2, expected: 3 });
  });
  it('handles a bare array', () => {
    expect(extractPresence([{ present: true }, { present: false }])).toEqual({ present: 1, expected: 2 });
  });
  it('returns zeros on null/empty/unexpected shapes', () => {
    expect(extractPresence(null)).toEqual({ present: 0, expected: 0 });
    expect(extractPresence({})).toEqual({ present: 0, expected: 0 });
  });
});

describe('Étage 0 — presence projection refresh (INV-4)', () => {
  let ds: DataSource;
  const ORG = uuidv4();
  const STORE = uuidv4();

  beforeAll(async () => {
    const { dataSource } = createPgMemDataSource();
    ds = dataSource.isInitialized ? dataSource : await dataSource.initialize();
    await ds.getRepository(OrganizationEntity).save({ id: ORG, name: 'Wesley' } as any);
    await ds.getRepository(StoreEntity).save({ id: STORE, name: 'Grand Littoral B43', organizationId: ORG, isActive: true, currencyCode: 'EUR' } as any);
  });
  afterAll(async () => {
    await ds?.destroy();
  });

  it('snapshots presence via the TimeWin24 proxy into the projection', async () => {
    const timewin = { getTodayShifts: async () => ({ shifts: [{ status: 'present' }, { status: 'present' }, { status: 'absent' }] }) };
    const svc = new PresenceProjectionRefreshService(
      ds.getRepository(StoreEntity),
      ds.getRepository(AnalyticsStorePresenceEntity),
      timewin as any,
    );
    await svc.refreshAll(new Date());
    const p = await ds.getRepository(AnalyticsStorePresenceEntity).findOne({ where: { storeId: STORE } });
    expect(p!.presentCount).toBe(2);
    expect(p!.expectedCount).toBe(3);
    expect(p!.computedAt).toBeTruthy();
  });

  it('keeps the last snapshot when the proxy is unreachable (no wipe on outage)', async () => {
    const failing = { getTodayShifts: async () => { throw new Error('proxy down'); } };
    const svc = new PresenceProjectionRefreshService(
      ds.getRepository(StoreEntity),
      ds.getRepository(AnalyticsStorePresenceEntity),
      failing as any,
    );
    await svc.refreshAll(new Date());
    const p = await ds.getRepository(AnalyticsStorePresenceEntity).findOne({ where: { storeId: STORE } });
    expect(p!.presentCount).toBe(2); // unchanged from the prior good snapshot
  });
});
