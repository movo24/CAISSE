/**
 * Decision: TimeWin24 events must NEVER be duplicated. pushEvent claims a UNIQUE
 * idempotency key before sending: an already-sent event is deduped (no second
 * network call), a failed send is retriable, and the ledger stays clean.
 */
import { DataSource } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { v4 as uuidv4 } from 'uuid';
import { createPgMemDataSource } from './helpers/pgmem';
import { TimewinEventEntity } from '../src/database/entities/timewin-event.entity';
import { TimewinService } from '../src/modules/timewin/timewin.service';

describe('TimeWin24 idempotency (no duplicate events)', () => {
  let ds: DataSource;
  let svc: TimewinService;
  const STORE = uuidv4();
  const EMP = uuidv4();

  // Stub the actual network call so we can count real sends.
  let sendCount = 0;
  let failNext = false;

  const makeService = () => {
    const config = { get: (_k: string, d?: any) => d } as unknown as ConfigService;
    const s = new TimewinService(config, ds.getRepository(TimewinEventEntity));
    (s as any).fetchWithPosSecret = async () => {
      if (failNext) {
        failNext = false;
        throw new Error('network down');
      }
      sendCount++;
      return { received: true, eventId: `evt-${sendCount}` };
    };
    return s;
  };

  beforeAll(async () => {
    const { dataSource } = createPgMemDataSource();
    ds = dataSource.isInitialized ? dataSource : await dataSource.initialize();
    svc = makeService();
  });
  afterAll(async () => {
    await ds?.destroy();
  });

  it('DECISIVE — the same key sent twice results in ONE network send (second is deduped)', async () => {
    const key = `session.opened:${uuidv4()}`;
    const r1 = await svc.pushEvent(STORE, 'session.opened', EMP, {}, key);
    const r2 = await svc.pushEvent(STORE, 'session.opened', EMP, {}, key);
    expect(r1.deduped).toBeFalsy();
    expect(r2.deduped).toBe(true);
    expect(sendCount).toBe(1); // exactly one real send despite two calls
    const rows = await ds.getRepository(TimewinEventEntity).find({ where: { idempotencyKey: key } });
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('sent');
  });

  it('DECISIVE — a failed send is recorded failed and RETRIES on the next call (resume clean)', async () => {
    const key = `session.closed:${uuidv4()}`;
    sendCount = 0;
    failNext = true;
    await expect(svc.pushEvent(STORE, 'session.closed', EMP, {}, key)).rejects.toThrow('network down');
    let row = await ds.getRepository(TimewinEventEntity).findOneByOrFail({ idempotencyKey: key });
    expect(row.status).toBe('failed');

    // retry: same key, now succeeds — no duplicate row, status flips to sent
    const r = await svc.pushEvent(STORE, 'session.closed', EMP, {}, key);
    expect(r.deduped).toBeFalsy();
    expect(sendCount).toBe(1);
    row = await ds.getRepository(TimewinEventEntity).findOneByOrFail({ idempotencyKey: key });
    expect(row.status).toBe('sent');
    expect(row.attempts).toBeGreaterThanOrEqual(2);
    expect(await ds.getRepository(TimewinEventEntity).count({ where: { idempotencyKey: key } })).toBe(1);
  });

  it('without a key (or repo), it still sends (degraded, no dedup) — backward compatible', async () => {
    sendCount = 0;
    await svc.pushEvent(STORE, 'stock.alert', EMP, { ruptures: 1 });
    await svc.pushEvent(STORE, 'stock.alert', EMP, { ruptures: 1 });
    expect(sendCount).toBe(2); // no key → no dedup, both sent
  });
});
