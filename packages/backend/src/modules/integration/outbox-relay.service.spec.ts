import { OutboxRelayService } from './outbox-relay.service';

/**
 * Service-level test with mocked repo + publisher (no DB). Verifies the relay
 * loop: eligibility filtering, publish call, and status transitions via relayOutcome.
 */
function makeRepo(rows: any[]) {
  return {
    find: jest.fn().mockResolvedValue(rows),
    update: jest.fn().mockResolvedValue({ affected: 1 }),
  };
}

describe('OutboxRelayService.relayBatch (mocked)', () => {
  it('publishes pending, retries failed-under-cap, skips capped, reports', async () => {
    const rows = [
      { id: 'a', status: 'pending', attempts: 0 },
      { id: 'b', status: 'failed', attempts: 4 }, // eligible (last retry → cap)
      { id: 'c', status: 'failed', attempts: 5 }, // NOT eligible (cap reached)
    ];
    const repo = makeRepo(rows);
    // publisher: succeed for 'a', fail for 'b'
    const publisher = {
      publish: jest.fn(async (e: any) => e.id === 'a'),
    };
    const svc = new OutboxRelayService(repo as any, publisher as any);

    const report = await svc.relayBatch(100);

    expect(report.processed).toBe(2); // a + b ; c skipped
    expect(report.published).toBe(1); // a
    expect(report.failed).toBe(1); // b hits cap (attempts 4→5)
    expect(publisher.publish).toHaveBeenCalledTimes(2);

    // 'a' → published
    expect(repo.update).toHaveBeenCalledWith('a', expect.objectContaining({ status: 'published', attempts: 1 }));
    // 'b' → failed (cap), attempts 5, no publishedAt
    expect(repo.update).toHaveBeenCalledWith('b', expect.objectContaining({ status: 'failed', attempts: 5, publishedAt: null }));
  });

  it('a publisher throw is treated as failure (pending retry), never propagates', async () => {
    const repo = makeRepo([{ id: 'x', status: 'pending', attempts: 0 }]);
    const publisher = { publish: jest.fn(async () => { throw new Error('sink down'); }) };
    const svc = new OutboxRelayService(repo as any, publisher as any);

    const report = await svc.relayBatch(10);

    expect(report.processed).toBe(1);
    expect(report.pending).toBe(1); // retry later
    expect(repo.update).toHaveBeenCalledWith('x', expect.objectContaining({ status: 'pending', attempts: 1 }));
  });
});
