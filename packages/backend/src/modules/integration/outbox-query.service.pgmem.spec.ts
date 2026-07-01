import { DataSource, Repository } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';

import { createPgMemDataSource } from '../../../test/helpers/pgmem';
import { OutboxQueryService } from './outbox-query.service';
import { IntegrationEventEntity } from '../../database/entities/integration-event.entity';

// PAQUET 271 — OutboxQueryService against a real in-memory Postgres (pg-mem),
// so the actual keyset query builder / tenant scope / type filter / stats
// grouping are exercised, not mocked. Consumer feed = GET /api/integration/events.

const STORE = 's1';
const OTHER = 's2';

async function seed(repo: Repository<IntegrationEventEntity>) {
  const base = {
    aggregateType: 'sale',
    organizationId: null as any,
    schemaVersion: 1,
    source: 'pos-caisse',
    status: 'pending',
    payload: {},
  };
  await repo.save([
    { ...base, id: uuidv4(), type: 'sale.completed', aggregateId: 'a1', storeId: STORE, occurredAt: new Date('2026-06-07T10:00:00Z') },
    { ...base, id: uuidv4(), type: 'stock.low', aggregateId: 'p1', storeId: STORE, occurredAt: new Date('2026-06-07T10:01:00Z') },
    { ...base, id: uuidv4(), type: 'sale.completed', aggregateId: 'a2', storeId: STORE, occurredAt: new Date('2026-06-07T10:02:00Z') },
    // other store — must never leak
    { ...base, id: uuidv4(), type: 'sale.completed', aggregateId: 'x1', storeId: OTHER, occurredAt: new Date('2026-06-07T10:03:00Z') },
  ] as any);
}

describe('OutboxQueryService (pg-mem)', () => {
  let dataSource: DataSource;
  let repo: Repository<IntegrationEventEntity>;
  let service: OutboxQueryService;

  beforeAll(async () => {
    const built = createPgMemDataSource();
    dataSource = built.dataSource;
    await dataSource.initialize();
    repo = dataSource.getRepository(IntegrationEventEntity);
    service = new OutboxQueryService(repo);
    await seed(repo);
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) await dataSource.destroy();
  });

  it('returns only the store events, ordered by occurredAt, with a resumable cursor', async () => {
    const res = await service.listForConsumer(STORE, {});
    expect(res.events.map((e) => e.aggregateId)).toEqual(['a1', 'p1', 'a2']);
    expect(res.events.every((e) => e.storeId === STORE)).toBe(true); // tenant scope
    expect(res.nextCursor).toContain('|');
  });

  it('filters by type', async () => {
    const res = await service.listForConsumer(STORE, { type: 'sale.completed' });
    expect(res.events.map((e) => e.aggregateId)).toEqual(['a1', 'a2']);
  });

  it('paginates with the cursor: limit=1 then resume returns the next event', async () => {
    const page1 = await service.listForConsumer(STORE, { limit: 1 });
    expect(page1.events).toHaveLength(1);
    expect(page1.events[0].aggregateId).toBe('a1');
    const page2 = await service.listForConsumer(STORE, { limit: 1, since: page1.nextCursor! });
    expect(page2.events[0].aggregateId).toBe('p1'); // strictly after, no loss/dup
  });

  it('stats groups counts per status/type for the store only', async () => {
    const stats = await service.stats(STORE);
    // 3 events for STORE, all pending; OTHER store excluded.
    expect(stats.total).toBe(3);
    expect(stats.byStatus.pending).toBe(3);
    expect(stats.byType['sale.completed']).toBe(2);
  });
});
