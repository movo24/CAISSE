import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { createHash } from 'crypto';
import { AuditEntryEntity } from '../../database/entities/audit-entry.entity';

const GENESIS_HASH =
  '0000000000000000000000000000000000000000000000000000000000000000';

function sha256(data: string): string {
  return createHash('sha256').update(data).digest('hex');
}

/**
 * LEGACY v1 hash (kept ONLY to read/understand old rows). BUG: the array replacer
 * filters nested keys, so `details` is serialised as `{}` — its content was never
 * covered by the hash. v1 rows are therefore verified by LINKAGE only.
 */
function computeAuditHash(
  previousHash: string,
  entryData: Record<string, unknown>,
): string {
  const payload =
    previousHash + JSON.stringify(entryData, Object.keys(entryData).sort());
  return sha256(payload);
}

/**
 * Deterministic canonical JSON: object keys sorted recursively so a jsonb round-trip
 * (which does not preserve key order) re-serialises identically. Arrays keep order.
 */
function canonicalize(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return '[' + value.map(canonicalize).join(',') + ']';
  const keys = Object.keys(value as Record<string, unknown>).sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + canonicalize((value as any)[k])).join(',') + '}';
}

/**
 * v2 audit hash (M402): fully covers action/entityType/entityId/details + the exact
 * hashed ISO timestamp, via a canonical (recursively key-sorted) serialisation.
 * Recomputable from the stored row → detects content tampering of `details`.
 */
export function computeAuditHashV2(
  previousHash: string,
  data: { action: string; entityType: string; entityId: string; details: unknown; timestamp: string },
): string {
  return sha256(previousHash + canonicalize(data));
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  /**
   * Per-store mutex to serialize hash chain writes.
   * Prevents two concurrent logs from getting the same previousHash.
   */
  private readonly storeLocks = new Map<string, Promise<any>>();

  constructor(
    @InjectRepository(AuditEntryEntity)
    private auditRepo: Repository<AuditEntryEntity>,
    private dataSource: DataSource,
  ) {}

  async log(params: {
    storeId: string;
    employeeId: string;
    action: string;
    entityType: string;
    entityId: string;
    details: Record<string, unknown>;
  }): Promise<AuditEntryEntity> {
    // Serialize writes per store to maintain hash chain integrity
    const key = params.storeId;
    const previousLock = this.storeLocks.get(key) || Promise.resolve();

    const currentLock = previousLock
      .catch(() => {}) // Don't let a failed log block subsequent logs
      .then(() => this.doLog(params));

    this.storeLocks.set(key, currentLock);

    try {
      return await currentLock;
    } finally {
      // Cleanup if this is still the latest lock
      if (this.storeLocks.get(key) === currentLock) {
        this.storeLocks.delete(key);
      }
    }
  }

  private async doLog(params: {
    storeId: string;
    employeeId: string;
    action: string;
    entityType: string;
    entityId: string;
    details: Record<string, unknown>;
  }): Promise<AuditEntryEntity> {
    // Anti-fork (M402): a concurrent writer can grab the same head between our read
    // and our INSERT; the unique (store_id, previous_hash) index makes the loser's
    // INSERT fail — re-read the head and re-chain instead of forking or dropping it.
    const MAX_ATTEMPTS = 4;
    let lastErr: unknown;
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const lastEntry = await this.auditRepo.findOne({
        where: { storeId: params.storeId },
        order: { timestamp: 'DESC' },
      });
      const previousHash = lastEntry?.currentHash || GENESIS_HASH;

      // v2: persist the EXACT hashed instant (hashedAt) so verifyChain can recompute.
      const ts = new Date();
      const hashedAt = ts.toISOString();
      const currentHash = computeAuditHashV2(previousHash, {
        action: params.action,
        entityType: params.entityType,
        entityId: params.entityId,
        details: params.details,
        timestamp: hashedAt,
      });

      const entry = this.auditRepo.create({
        id: uuidv4(),
        ...params,
        previousHash,
        currentHash,
        hashedAt,
        timestamp: ts,
      });

      try {
        return await this.auditRepo.save(entry);
      } catch (e: unknown) {
        if (this.isUniqueViolation(e) && attempt < MAX_ATTEMPTS - 1) {
          lastErr = e;
          continue; // head moved under us → retry with the new head
        }
        throw e;
      }
    }
    throw lastErr;
  }

  /** Postgres unique-violation (23505) / pg-mem equivalent. */
  private isUniqueViolation(e: unknown): boolean {
    const err = e as { code?: string; message?: string };
    return err?.code === '23505' || /unique|duplicate key/i.test(err?.message ?? '');
  }

  async getEntries(
    storeId: string,
    limit = 100,
    offset = 0,
  ): Promise<AuditEntryEntity[]> {
    return this.auditRepo.find({
      where: { storeId },
      order: { timestamp: 'DESC' },
      take: limit,
      skip: offset,
    });
  }

  /**
   * Verify the per-store audit chain (M402). Two checks per row:
   *  (1) LINKAGE — previousHash must point at the prior row's currentHash (detects
   *      insertion/deletion/reordering); applies to every row.
   *  (2) RECOMPUTE — for v2 rows (hashedAt set), re-derive currentHash from the LIVE
   *      columns and compare → detects content tampering of `details`. v1 rows are
   *      linkage-only (their hash never covered `details`).
   * `reason` distinguishes a linkage break from a content-tamper. Read-only.
   */
  async verifyChain(
    storeId: string,
  ): Promise<{ valid: boolean; brokenAt?: string; reason?: 'linkage' | 'hash_mismatch' }> {
    const entries = await this.auditRepo.find({
      where: { storeId },
      order: { timestamp: 'ASC' },
    });

    let expectedPrevHash = GENESIS_HASH;
    for (const entry of entries) {
      if (entry.previousHash !== expectedPrevHash) {
        return { valid: false, brokenAt: entry.id, reason: 'linkage' };
      }
      if (entry.hashedAt != null) {
        const recomputed = computeAuditHashV2(entry.previousHash, {
          action: entry.action,
          entityType: entry.entityType,
          entityId: entry.entityId,
          details: entry.details,
          timestamp: entry.hashedAt,
        });
        if (recomputed !== entry.currentHash) {
          return { valid: false, brokenAt: entry.id, reason: 'hash_mismatch' };
        }
      }
      expectedPrevHash = entry.currentHash;
    }

    return { valid: true };
  }
}
