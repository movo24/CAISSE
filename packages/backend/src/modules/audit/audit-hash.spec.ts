import {
  computeAuditHash,
  verifyAuditChain,
  GENESIS_HASH,
  AuditChainEntry,
} from './audit-hash';

describe('POS-056/120 audit-hash', () => {
  const data1 = { action: 'sale_completed', total: 1500 };
  const data2 = { action: 'discount_applied', pct: 10 };

  describe('computeAuditHash', () => {
    it('is deterministic', () => {
      expect(computeAuditHash(GENESIS_HASH, data1)).toBe(
        computeAuditHash(GENESIS_HASH, data1),
      );
    });
    it('is independent of key order (canonical JSON)', () => {
      expect(computeAuditHash(GENESIS_HASH, { a: 1, b: 2 })).toBe(
        computeAuditHash(GENESIS_HASH, { b: 2, a: 1 }),
      );
    });
    it('changes when previousHash changes', () => {
      expect(computeAuditHash(GENESIS_HASH, data1)).not.toBe(
        computeAuditHash('1'.repeat(64), data1),
      );
    });
    it('changes when data changes', () => {
      expect(computeAuditHash(GENESIS_HASH, data1)).not.toBe(
        computeAuditHash(GENESIS_HASH, { ...data1, total: 1501 }),
      );
    });
  });

  describe('verifyAuditChain', () => {
    const build = (): AuditChainEntry[] => {
      const h1 = computeAuditHash(GENESIS_HASH, data1);
      const h2 = computeAuditHash(h1, data2);
      return [
        { previousHash: GENESIS_HASH, currentHash: h1, data: data1 },
        { previousHash: h1, currentHash: h2, data: data2 },
      ];
    };

    it('valid chain passes', () => {
      expect(verifyAuditChain(build())).toEqual({ valid: true, brokenAtIndex: null });
    });
    it('empty chain is valid', () => {
      expect(verifyAuditChain([]).valid).toBe(true);
    });
    it('detects a broken link', () => {
      const c = build();
      c[1].previousHash = 'deadbeef';
      const r = verifyAuditChain(c);
      expect(r.valid).toBe(false);
      expect(r.brokenAtIndex).toBe(1);
      expect(r.reason).toBe('linkage');
    });
    it('detects tampered data (hash no longer matches)', () => {
      const c = build();
      c[0].data = { ...c[0].data, total: 9999 };
      const r = verifyAuditChain(c);
      expect(r.valid).toBe(false);
      expect(r.brokenAtIndex).toBe(0);
      expect(r.reason).toBe('tamper');
    });
  });
});
