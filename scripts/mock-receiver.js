#!/usr/bin/env node
/**
 * mock-receiver.js — GATE 1 rehearsal receiver (P288, bloc B1).
 *
 * A tiny standalone HTTP receiver implementing the POS_PUSH_CONTRACT.md
 * receiver side: HMAC verification (`${timestamp}.${body}`), 5-min freshness
 * window, idempotent dedup by x-pos-event-id. Lets you prove the real push
 * chain locally WITHOUT any real secret or consumer system.
 *
 * Usage:
 *   node scripts/mock-receiver.js                       # port 4545, secret 'local-rehearsal-secret'
 *   PORT=5000 SECRET=mysecret node scripts/mock-receiver.js
 *
 * Then point the backend at it (locally generated values, NOT real secrets):
 *   export OUTBOX_PUBLISH_URL="http://localhost:4545/webhook/pos"
 *   export OUTBOX_PUBLISH_SECRET="local-rehearsal-secret"
 *   export OUTBOX_RELAY_ENABLED="true"
 *
 * Endpoints:
 *   POST /webhook/pos  → 200 {status:'accepted'|'duplicate'} | 401 bad signature | 400 stale/malformed
 *   GET  /received     → JSON dump of accepted events (id, type, batchId, receivedAt)
 *   GET  /health       → 200
 *   POST /fail-next    → force the next N deliveries to 500 (retry/dead-letter rehearsal): {"n": 3}
 */
const http = require('http');
const { createHmac, timingSafeEqual } = require('crypto');

const PORT = Number(process.env.PORT || 4545);
const SECRET = process.env.SECRET || 'local-rehearsal-secret';
const FRESHNESS_MS = 5 * 60 * 1000;

const seen = new Map(); // eventId → summary
let failNext = 0;

function sign(body, ts) {
  return createHmac('sha256', SECRET).update(`${ts}.${body}`).digest('hex');
}
function safeEqualHex(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  try { return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex')); } catch { return false; }
}
function json(res, code, obj) {
  res.writeHead(code, { 'content-type': 'application/json' });
  res.end(JSON.stringify(obj));
}

const server = http.createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/health') return json(res, 200, { ok: true });
  if (req.method === 'GET' && req.url === '/received') return json(res, 200, [...seen.values()]);
  if (req.method === 'POST' && req.url === '/fail-next') {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => { failNext = Number(JSON.parse(raw || '{}').n || 1); json(res, 200, { failNext }); });
    return;
  }
  if (req.method === 'POST' && req.url === '/webhook/pos') {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      if (failNext > 0) { failNext--; return json(res, 500, { error: 'forced failure (rehearsal)' }); }
      const sig = req.headers['x-pos-signature'];
      const ts = Number(req.headers['x-pos-timestamp']);
      const eventId = req.headers['x-pos-event-id'];
      const batchId = req.headers['x-pos-batch-id'] || null;
      if (!raw || !sig || !Number.isFinite(ts) || !eventId) return json(res, 400, { error: 'malformed' });
      if (Math.abs(Date.now() - ts) > FRESHNESS_MS) return json(res, 400, { error: 'stale (replay guard)' });
      if (!safeEqualHex(String(sig), sign(raw, ts))) return json(res, 401, { error: 'bad signature' });
      if (seen.has(eventId)) {
        console.log(`[dup]      ${eventId} (batch=${batchId}) → 200 idempotent ack`);
        return json(res, 200, { status: 'duplicate' }); // idempotent ack per contract §4
      }
      const env = JSON.parse(raw);
      seen.set(eventId, { id: eventId, type: env.type, store: env.storeId, batchId, receivedAt: new Date().toISOString() });
      console.log(`[accepted] ${env.type} ${eventId} store=${env.storeId} batch=${batchId} (total=${seen.size})`);
      return json(res, 200, { status: 'accepted' });
    });
    return;
  }
  json(res, 404, { error: 'not found' });
});

server.listen(PORT, () => {
  console.log(`Mock POS receiver on http://localhost:${PORT}`);
  console.log(`  webhook : POST /webhook/pos   (secret: ${SECRET === 'local-rehearsal-secret' ? 'default rehearsal secret' : 'from env'})`);
  console.log(`  inspect : GET  /received`);
  console.log(`  chaos   : POST /fail-next {"n":3}`);
});
