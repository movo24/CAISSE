import { createServer, Server } from 'http';
import { AddressInfo } from 'net';
import {
  HttpOutboxPublisher,
  SimulationOutboxPublisher,
  createOutboxPublisher,
} from './outbox-publisher';
import { verifyPublishSignature } from './publish-request';

/**
 * POS-INT-171 — loopback proof for the gated HTTP outbox publisher (TD-INT-RELAY).
 * No real URL/secret, no external push: a localhost server stands in for the
 * downstream (Comptamax24 / TimeWin24 / Analytik R) and verifies the signed
 * delivery end-to-end. Proves delivery + HMAC roundtrip; prod only needs the URL
 * + secret env vars.
 */
const FAKE_SECRET = 'loopback-test-secret-not-real';

function fakeEvent(over: Partial<any> = {}): any {
  return {
    id: 'evt-1',
    type: 'sale.created',
    aggregateType: 'sale',
    aggregateId: 'sale-1',
    storeId: 'store-1',
    organizationId: 'org-1',
    terminalId: 'term-1',
    occurredAt: new Date('2026-07-01T10:00:00.000Z'),
    payload: { totalMinorUnits: 1234 },
    schemaVersion: 1,
    source: 'pos',
    ...over,
  };
}

/** Start a localhost receiver; captures the last request and replies `status`. */
function startReceiver(status: number): Promise<{
  server: Server;
  url: string;
  last: () => { body: string; headers: Record<string, any> } | null;
}> {
  let last: { body: string; headers: Record<string, any> } | null = null;
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        last = { body, headers: req.headers as any };
        res.statusCode = status;
        res.end('ok');
      });
    });
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve({ server, url: `http://127.0.0.1:${port}/webhook`, last: () => last });
    });
  });
}

describe('HttpOutboxPublisher (POS-INT-171, loopback)', () => {
  it('delivers a signed envelope the receiver can verify, returns true on 2xx', async () => {
    const recv = await startReceiver(200);
    try {
      const pub = new HttpOutboxPublisher(recv.url, FAKE_SECRET);
      const ok = await pub.publish(fakeEvent());
      expect(ok).toBe(true);

      const got = recv.last()!;
      expect(got).not.toBeNull();
      // Receiver re-verifies the HMAC over the exact body it received.
      const ts = Number(got.headers['x-pos-timestamp']);
      const sig = got.headers['x-pos-signature'];
      expect(verifyPublishSignature(got.body, sig, FAKE_SECRET, ts)).toBe('ok');
      // Envelope integrity.
      const parsed = JSON.parse(got.body);
      expect(parsed).toMatchObject({ id: 'evt-1', type: 'sale.created', storeId: 'store-1' });
      expect(got.headers['x-pos-event-id']).toBe('evt-1');
    } finally {
      recv.server.close();
    }
  });

  it('returns false on non-2xx (dead-letter path)', async () => {
    const recv = await startReceiver(500);
    try {
      const pub = new HttpOutboxPublisher(recv.url, FAKE_SECRET);
      expect(await pub.publish(fakeEvent())).toBe(false);
    } finally {
      recv.server.close();
    }
  });

  it('a tampered body fails receiver verification (integrity)', async () => {
    const recv = await startReceiver(200);
    try {
      const pub = new HttpOutboxPublisher(recv.url, FAKE_SECRET);
      await pub.publish(fakeEvent());
      const got = recv.last()!;
      const ts = Number(got.headers['x-pos-timestamp']);
      const tampered = got.body.replace('1234', '9999');
      expect(verifyPublishSignature(tampered, got.headers['x-pos-signature'], FAKE_SECRET, ts)).toBe('bad_signature');
    } finally {
      recv.server.close();
    }
  });
});

describe('createOutboxPublisher (factory gate)', () => {
  const save = { url: process.env.OUTBOX_PUBLISH_URL, secret: process.env.OUTBOX_PUBLISH_SECRET };
  afterEach(() => {
    process.env.OUTBOX_PUBLISH_URL = save.url;
    process.env.OUTBOX_PUBLISH_SECRET = save.secret;
  });

  it('returns simulation sink when env unset', () => {
    delete process.env.OUTBOX_PUBLISH_URL;
    delete process.env.OUTBOX_PUBLISH_SECRET;
    expect(createOutboxPublisher()).toBeInstanceOf(SimulationOutboxPublisher);
  });

  it('returns HTTP sink only when both url + secret set', () => {
    process.env.OUTBOX_PUBLISH_URL = 'http://127.0.0.1:9/webhook';
    process.env.OUTBOX_PUBLISH_SECRET = FAKE_SECRET;
    expect(createOutboxPublisher()).toBeInstanceOf(HttpOutboxPublisher);
  });
});
