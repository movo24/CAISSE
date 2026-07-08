import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { newIdempotencyKey } from './idempotency';

describe('newIdempotencyKey', () => {
  it('is unique across calls', () => {
    const keys = new Set(Array.from({ length: 500 }, () => newIdempotencyKey()));
    expect(keys.size).toBe(500);
  });

  it('is prefixed and within the 64-char backend limit', () => {
    const k = newIdempotencyKey();
    expect(k.startsWith('sale-')).toBe(true);
    expect(k.length).toBeGreaterThan(8);
    expect(k.length).toBeLessThanOrEqual(64);
  });

  it('accepts a custom prefix', () => {
    expect(newIdempotencyKey('void').startsWith('void-')).toBe(true);
  });
});

/**
 * Wiring invariants (source-level): the online sale carries ONE idempotency key,
 * reused on retry, cleared after success, and mirrored into the offline enqueue
 * so a lost-response create is deduped, not duplicated.
 */
describe('usePayment — idempotency wiring (source)', () => {
  const src = readFileSync(join(__dirname, '..', 'hooks', 'usePayment.ts'), 'utf8');

  it('generates a stable key once per checkout (ref) and passes it to create', () => {
    expect(src).toMatch(/saleIdemKeyRef\.current\s*=\s*newIdempotencyKey\(\)/);
    expect(src).toMatch(/salesApi\.create\([\s\S]*?\},\s*idempotencyKey\)/);
  });

  it('resets the key after a confirmed sale (online + offline paths)', () => {
    const resets = src.match(/saleIdemKeyRef\.current\s*=\s*null/g) || [];
    expect(resets.length).toBeGreaterThanOrEqual(2);
  });

  it('carries the same key into the offline enqueue payload', () => {
    expect(src).toMatch(/idempotencyKey,\s*\n\s*\},\s*\n\s*cashierId/);
  });
});

describe('syncEngine — prefers the online idempotency key (source)', () => {
  const src = readFileSync(join(__dirname, 'syncEngine.ts'), 'utf8');
  it('uses payload.idempotencyKey when present, else the durable derived key', () => {
    expect(src).toMatch(/entry\.payload as any\)\?\.idempotencyKey \|\| idempotencyKeyFor/);
  });
});
