/**
 * Tests for Audit Hash Chain
 *
 * Validates the hash chain integrity mechanism.
 */

import { createHash } from 'crypto';

function sha256(data: string): string {
  return createHash('sha256').update(data).digest('hex');
}

function createAuditHash(
  previousHash: string,
  entryData: Record<string, unknown>,
): string {
  const payload =
    previousHash +
    JSON.stringify(entryData, Object.keys(entryData).sort());
  return sha256(payload);
}

function verifyAuditHash(
  previousHash: string,
  entryData: Record<string, unknown>,
  expectedHash: string,
): boolean {
  const computed = createAuditHash(previousHash, entryData);
  return computed === expectedHash;
}

const GENESIS_HASH =
  '0000000000000000000000000000000000000000000000000000000000000000';

describe('Audit Hash Chain', () => {
  describe('Hash Creation', () => {
    it('should create a deterministic hash', () => {
      const data = { action: 'sale_completed', total: 2990 };
      const hash1 = createAuditHash(GENESIS_HASH, data);
      const hash2 = createAuditHash(GENESIS_HASH, data);
      expect(hash1).toBe(hash2);
    });

    it('should create a 64-char hex hash (SHA-256)', () => {
      const data = { action: 'sale_completed', total: 2990 };
      const hash = createAuditHash(GENESIS_HASH, data);
      expect(hash).toHaveLength(64);
      expect(hash).toMatch(/^[a-f0-9]{64}$/);
    });

    it('should produce different hashes for different data', () => {
      const hash1 = createAuditHash(GENESIS_HASH, { action: 'sale_completed' });
      const hash2 = createAuditHash(GENESIS_HASH, { action: 'sale_voided' });
      expect(hash1).not.toBe(hash2);
    });

    it('should produce different hashes for different previous hashes', () => {
      const data = { action: 'sale_completed' };
      const hash1 = createAuditHash(GENESIS_HASH, data);
      const hash2 = createAuditHash(
        'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        data,
      );
      expect(hash1).not.toBe(hash2);
    });
  });

  describe('Hash Verification', () => {
    it('should verify a valid hash', () => {
      const data = { action: 'sale_completed', total: 2990 };
      const hash = createAuditHash(GENESIS_HASH, data);
      expect(verifyAuditHash(GENESIS_HASH, data, hash)).toBe(true);
    });

    it('should reject a tampered hash', () => {
      const data = { action: 'sale_completed', total: 2990 };
      const hash = createAuditHash(GENESIS_HASH, data);
      expect(verifyAuditHash(GENESIS_HASH, data, 'tampered' + hash.slice(8))).toBe(
        false,
      );
    });

    it('should reject tampered data', () => {
      const data = { action: 'sale_completed', total: 2990 };
      const hash = createAuditHash(GENESIS_HASH, data);
      const tamperedData = { action: 'sale_completed', total: 1000 };
      expect(verifyAuditHash(GENESIS_HASH, tamperedData, hash)).toBe(false);
    });
  });

  describe('Chain Integrity', () => {
    it('should build a valid 3-entry chain', () => {
      const entry1Data = { action: 'sale_completed', ticket: 'T-000001' };
      const hash1 = createAuditHash(GENESIS_HASH, entry1Data);

      const entry2Data = { action: 'sale_completed', ticket: 'T-000002' };
      const hash2 = createAuditHash(hash1, entry2Data);

      const entry3Data = { action: 'drawer_opened', reason: 'cash' };
      const hash3 = createAuditHash(hash2, entry3Data);

      // Verify chain
      expect(verifyAuditHash(GENESIS_HASH, entry1Data, hash1)).toBe(true);
      expect(verifyAuditHash(hash1, entry2Data, hash2)).toBe(true);
      expect(verifyAuditHash(hash2, entry3Data, hash3)).toBe(true);
    });

    it('should detect a broken chain (modified middle entry)', () => {
      const entry1Data = { action: 'sale_completed', ticket: 'T-000001' };
      const hash1 = createAuditHash(GENESIS_HASH, entry1Data);

      const entry2Data = { action: 'sale_completed', ticket: 'T-000002' };
      const hash2 = createAuditHash(hash1, entry2Data);

      // Tamper with entry 2 data but keep hash2 the same
      const tamperedEntry2 = { action: 'sale_completed', ticket: 'T-FAKE' };
      expect(verifyAuditHash(hash1, tamperedEntry2, hash2)).toBe(false);
    });
  });

  describe('Key Sorting Consistency', () => {
    it('should produce the same hash regardless of key order in input', () => {
      const data1 = { b: 2, a: 1, c: 3 };
      const data2 = { c: 3, a: 1, b: 2 };
      const hash1 = createAuditHash(GENESIS_HASH, data1);
      const hash2 = createAuditHash(GENESIS_HASH, data2);
      expect(hash1).toBe(hash2);
    });
  });
});
