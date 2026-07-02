import * as http from 'http';
import { DataSource, Repository } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';

import { createPgMemDataSource } from '../../../test/helpers/pgmem';
import { IntegrationEventEntity } from '../../database/entities/integration-event.entity';
import { OutboxRelayService } from './outbox-relay.service';
import { HttpOutboxPublisher } from './outbox-publisher';
import { verifyPublishSignature } from './publish-request';

// PAQUET 288 (bloc B1) — FULL-CHAIN GATE 1 rehearsal, zero real secret:
// OutboxRelayService (real DB rows, pg-mem) → HttpOutboxPublisher (real axios
// POST) → real loopback HTTP receiver (verifies HMAC + freshness + dedups by
// event id, exactly like scripts/mock-receiver.js) → delivery statuses
// mutated in DB. This is the end-to-end proof that GATE 1 only lacks the
// real URL+secret — every mechanical piece works together.

const SECRET = 'loopback-rehearsal-secret';

describe('GATE 1 rehearsal — relay → HTTP → receiver → DB statuses (loopback, pg-mem)', () => {
  let dataSource: DataSource;
  let repo: Repository<IntegrationEventEntity>;
  let server: http.Server;
  let url: string;

  const receiver = {
    accepted: [] as Array<{ id: string; batchId: string | null }>,
    duplicates: 0,
    rejected: 0,
    failNext: 0,
  };

  const mkEvent = (over: Partial<IntegrationEventEntity> = {}) =>
    repo.save(
      repo.create({
        id: uuidv4(),
        type: 'sale.completed',
        aggregateType: 'sale',
        aggregateId: uuidv4(),
        storeId: 'store-1',
        organizationId: null,
        terminalId: 'term-1',
        occurredAt: new Date(),
        payload: { totalMinorUnits: 500 },
        schemaVersion: 1,
        source: 'pos-caisse',
        status: 'pending',
        attempts: 0,
        ...over,
      } as Partial<IntegrationEventEntity>),
    );

  beforeAll(async () => {
    const built = createPgMemDataSource();
    dataSource = built.dataSource;
    await dataSource.initialize();
    repo = dataSource.getRepository(IntegrationEventEntity);

    // Real loopback receiver implementing the contract's receiver side.
    server = http.createServer((req, res) => {
      let raw = '';
      req.on('data', (c) => (raw += c));
      req.on('end', () => {
        if (receiver.failNext > 0) {
          receiver.failNext--;
          res.writeHead(500).end();
          return;
        }
        const sig = String(req.headers['x-pos-signature'] ?? '');
        const ts = Number(req.headers['x-pos-timestamp']);
        const eventId = String(req.headers['x-pos-event-id'] ?? '');
        if (verifyPublishSignature(raw, sig, SECRET, ts) !== 'ok') {
          receiver.rejected++;
          res.writeHead(401).end();
          return;
        }
        if (receiver.accepted.some((a) => a.id === eventId)) {
          receiver.duplicates++;
          res.writeHead(200).end(); // idempotent ack (contract §4)
          return;
        }
        receiver.accepted.push({
          id: eventId,
          batchId: (req.headers['x-pos-batch-id'] as string) ?? null,
        });
        res.writeHead(200).end();
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const addr = server.address() as { port: number };
    url = `http://127.0.0.1:${addr.port}/webhook/pos`;
  });

  afterAll(async () => {
    await new Promise<void>((r) => server.close(() => r()));
    if (dataSource?.isInitialized) await dataSource.destroy();
  });

  it('relays pending events end-to-end: receiver verifies HMAC, DB rows become published, batch id carried', async () => {
    const e1 = await mkEvent();
    const e2 = await mkEvent({ type: 'stock.low', aggregateType: 'product' });
    const relay = new OutboxRelayService(repo, new HttpOutboxPublisher(url, SECRET));

    const report = await relay.relayBatch(50);
    expect(report.processed).toBe(2);
    expect(report.published).toBe(2);
    expect(receiver.rejected).toBe(0);
    expect(receiver.accepted.map((a) => a.id).sort()).toEqual([e1.id, e2.id].sort());
    expect(receiver.accepted.every((a) => a.batchId === report.batchId)).toBe(true);

    const rows = await repo.find();
    expect(rows.every((r) => r.status === 'published' && r.publishedAt !== null)).toBe(true);
  });

  it('second relay run finds nothing eligible (published rows never re-sent)', async () => {
    const before = receiver.accepted.length;
    const relay = new OutboxRelayService(repo, new HttpOutboxPublisher(url, SECRET));
    const report = await relay.relayBatch(50);
    expect(report.processed).toBe(0);
    expect(receiver.accepted.length).toBe(before);
  });

  it('a wrong secret is rejected by the receiver (401) and the row stays retryable — never silently lost', async () => {
    const bad = await mkEvent({ type: 'sale.voided' });
    const relay = new OutboxRelayService(repo, new HttpOutboxPublisher(url, 'WRONG-secret'));
    const report = await relay.relayBatch(50);
    expect(report.published).toBe(0);
    expect(receiver.rejected).toBeGreaterThan(0);
    const row = (await repo.findOneBy({ id: bad.id }))!;
    expect(row.status).toBe('pending'); // retryable
    expect(row.attempts).toBe(1);
    // cleanup: deliver it properly so later tests start clean
    await new OutboxRelayService(repo, new HttpOutboxPublisher(url, SECRET)).relayBatch(50);
  });

  it('receiver failures (5xx) increment attempts until the dead-letter cap (failed after 5)', async () => {
    const doomed = await mkEvent({ type: 'stock.depleted' });
    const relay = new OutboxRelayService(repo, new HttpOutboxPublisher(url, SECRET));
    receiver.failNext = 99; // receiver down
    for (let i = 0; i < 5; i++) await relay.relayBatch(50);
    receiver.failNext = 0;

    const row = (await repo.findOneBy({ id: doomed.id }))!;
    expect(row.attempts).toBe(5);
    expect(row.status).toBe('failed'); // dead-letter per contract §4

    const after = await relay.relayBatch(50); // capped row is NOT retried
    expect(after.processed).toBe(0);
  });

  it('ANTI-REJEU e2e: a receiver enforcing the freshness window rejects a stale delivery (401-class), row stays retryable', async () => {
    // Rewind the receiver's clock tolerance: verify with nowMs far in the future
    // → any fresh delivery looks stale. This proves the receiver-side replay
    // guard END-TO-END (not just the unit-tested verify function).
    const evt = await mkEvent({ type: 'cash_session.closed' });
    const staleServer = http.createServer((req, res) => {
      let raw = '';
      req.on('data', (c) => (raw += c));
      req.on('end', () => {
        const sig = String(req.headers['x-pos-signature'] ?? '');
        const ts = Number(req.headers['x-pos-timestamp']);
        const verdict = verifyPublishSignature(raw, sig, SECRET, ts, {
          nowMs: Date.now() + 10 * 60 * 1000, // receiver clock 10 min ahead → delivery outside the 5-min window
        });
        res.writeHead(verdict === 'ok' ? 200 : 401).end();
      });
    });
    await new Promise<void>((r) => staleServer.listen(0, '127.0.0.1', r));
    const staleUrl = `http://127.0.0.1:${(staleServer.address() as { port: number }).port}/webhook/pos`;
    try {
      const relay = new OutboxRelayService(repo, new HttpOutboxPublisher(staleUrl, SECRET));
      const report = await relay.relayBatch(50);
      expect(report.published).toBe(0); // stale → refused
      const row = (await repo.findOneBy({ id: evt.id }))!;
      expect(row.status).toBe('pending'); // retryable, never lost
      expect(row.attempts).toBeGreaterThanOrEqual(1);
    } finally {
      await new Promise<void>((r) => staleServer.close(() => r()));
      await new OutboxRelayService(repo, new HttpOutboxPublisher(url, SECRET)).relayBatch(50); // clean up
    }
  });

  it('a retried delivery reaching the receiver twice is deduped by event id (idempotent ack)', async () => {
    const evt = await mkEvent({ type: 'payment.captured' });
    const relay = new OutboxRelayService(repo, new HttpOutboxPublisher(url, SECRET));
    await relay.relayBatch(50); // delivered + published
    // simulate an at-least-once redelivery (e.g. ack lost): force re-send of the same row
    await repo.update(evt.id, { status: 'pending' });
    const dupBefore = receiver.duplicates;
    await relay.relayBatch(50);
    expect(receiver.duplicates).toBe(dupBefore + 1); // receiver acked idempotently, no double processing
  });
});
