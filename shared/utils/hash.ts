import { createHash } from 'crypto';

/** Create SHA-256 hash for audit chain */
export function sha256(data: string): string {
  return createHash('sha256').update(data).digest('hex');
}

/** Create audit hash: SHA-256(previousHash + serializedEntry) */
export function createAuditHash(
  previousHash: string,
  entryData: Record<string, unknown>,
): string {
  const payload = previousHash + JSON.stringify(entryData, Object.keys(entryData).sort());
  return sha256(payload);
}

/** Verify an audit chain entry */
export function verifyAuditHash(
  previousHash: string,
  entryData: Record<string, unknown>,
  expectedHash: string,
): boolean {
  const computed = createAuditHash(previousHash, entryData);
  return computed === expectedHash;
}
