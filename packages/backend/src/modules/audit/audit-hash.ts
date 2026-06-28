import { createHash } from 'crypto';

/**
 * POS-056/POS-120 — Audit hash-chain primitives (pure, unit-testable).
 * Extracted verbatim from AuditService (behavior-preserving): the chain formula is
 * sha256(previousHash + JSON.stringify(entryData, sortedKeys)).
 *
 * NOTE: `shared/utils/hash.ts` holds an equivalent copy (`createAuditHash`). The backend
 * does not import `@caisse/shared` today; reconciling the two copies is TD-AUDIT-HASH-DUP.
 */

export const GENESIS_HASH =
  '0000000000000000000000000000000000000000000000000000000000000000';

export function sha256(data: string): string {
  return createHash('sha256').update(data).digest('hex');
}

/** Chain hash for an entry: sha256(previousHash + canonical(entryData)). Keys sorted → stable. */
export function computeAuditHash(
  previousHash: string,
  entryData: Record<string, unknown>,
): string {
  const payload =
    previousHash + JSON.stringify(entryData, Object.keys(entryData).sort());
  return sha256(payload);
}

export interface AuditChainEntry {
  previousHash: string;
  currentHash: string;
  data: Record<string, unknown>;
}

export interface ChainVerifyResult {
  valid: boolean;
  /** Index of the first faulty entry, or null when valid. */
  brokenAtIndex: number | null;
  reason?: 'linkage' | 'tamper';
}

/**
 * Verify an ORDERED audit chain (oldest → newest). Two independent checks per entry:
 *  - linkage: entry.previousHash equals the running head (genesis for the first);
 *  - integrity: recomputing the hash from previousHash + data equals entry.currentHash.
 */
export function verifyAuditChain(
  entries: AuditChainEntry[],
  genesis: string = GENESIS_HASH,
): ChainVerifyResult {
  let head = genesis;
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    if (e.previousHash !== head) {
      return { valid: false, brokenAtIndex: i, reason: 'linkage' };
    }
    if (computeAuditHash(e.previousHash, e.data) !== e.currentHash) {
      return { valid: false, brokenAtIndex: i, reason: 'tamper' };
    }
    head = e.currentHash;
  }
  return { valid: true, brokenAtIndex: null };
}
