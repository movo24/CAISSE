import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource, EntityManager } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { createHash } from 'crypto';
import { AuditEntryEntity } from '../../database/entities/audit-entry.entity';

export interface AuditLogParams {
  storeId: string;
  employeeId: string;
  action: string;
  entityType: string;
  entityId: string;
  details: Record<string, unknown>;
}

const GENESIS_HASH =
  '0000000000000000000000000000000000000000000000000000000000000000';

function sha256(data: string): string {
  return createHash('sha256').update(data).digest('hex');
}

function computeAuditHash(
  previousHash: string,
  entryData: Record<string, unknown>,
): string {
  const payload =
    previousHash + JSON.stringify(entryData, Object.keys(entryData).sort());
  return sha256(payload);
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

  /**
   * Standalone, NON-transactional append (the post-hoc pattern: e.g. the void
   * audit, logged after the fiscal action has already committed). For an admin
   * MUTATION that must be paired atomically with its audit entry, use
   * `runWithAudit` instead — never this.
   */
  async log(params: AuditLogParams): Promise<AuditEntryEntity> {
    return this.withStoreLock(params.storeId, () =>
      this.appendEntry(this.auditRepo.manager, params),
    );
  }

  /**
   * STRUCTURAL atomic audit (prevent-at-write applied to the audit itself):
   * runs `mutation` and the chained audit append in ONE database transaction.
   * If either throws, BOTH roll back — there is no code path that commits the
   * mutation without its audit entry. The same per-store serialization as
   * `log()` is held across the whole transaction, so admin-audit and the
   * post-hoc `log()` path share ONE chain-append domain per store.
   *
   * (Single-process serialization via the in-memory mutex — multi-instance
   * chain-head serialization, a DB advisory lock, is the parked owner/infra
   * hardening; the mutation↔entry atomicity here does NOT depend on it.)
   */
  async runWithAudit<T>(
    params: AuditLogParams,
    mutation: (manager: EntityManager) => Promise<T>,
  ): Promise<T> {
    return this.withStoreLock(params.storeId, () =>
      this.dataSource.transaction(async (manager) => {
        const result = await mutation(manager);
        await this.appendEntry(manager, params);
        return result;
      }),
    );
  }

  /** Per-store serialization of chain appends (prevents a duplicate previousHash). */
  private withStoreLock<T>(storeId: string, fn: () => Promise<T>): Promise<T> {
    const previousLock = this.storeLocks.get(storeId) || Promise.resolve();
    const currentLock = previousLock
      .catch(() => {}) // a failed append must not block subsequent ones
      .then(fn);
    this.storeLocks.set(storeId, currentLock);
    return (async () => {
      try {
        return await currentLock;
      } finally {
        if (this.storeLocks.get(storeId) === currentLock) {
          this.storeLocks.delete(storeId);
        }
      }
    })();
  }

  /**
   * The shared chain-append core (transaction-aware via `manager`): reads the
   * store's chain head, computes the next hash, inserts the entry. Caller holds
   * the per-store lock.
   */
  private async appendEntry(
    manager: EntityManager,
    params: AuditLogParams,
  ): Promise<AuditEntryEntity> {
    const repo = manager.getRepository(AuditEntryEntity);
    const lastEntry = await repo.findOne({
      where: { storeId: params.storeId },
      order: { timestamp: 'DESC' },
    });
    const previousHash = lastEntry?.currentHash || GENESIS_HASH;

    const entryData = {
      action: params.action,
      entityType: params.entityType,
      entityId: params.entityId,
      details: params.details,
      timestamp: new Date().toISOString(),
    };
    const currentHash = computeAuditHash(previousHash, entryData);

    const entry = repo.create({
      id: uuidv4(),
      ...params,
      previousHash,
      currentHash,
    });

    return repo.save(entry);
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

  async verifyChain(
    storeId: string,
  ): Promise<{ valid: boolean; brokenAt?: string }> {
    const entries = await this.auditRepo.find({
      where: { storeId },
      order: { timestamp: 'ASC' },
    });

    let expectedPrevHash = GENESIS_HASH;
    for (const entry of entries) {
      if (entry.previousHash !== expectedPrevHash) {
        return { valid: false, brokenAt: entry.id };
      }
      expectedPrevHash = entry.currentHash;
    }

    return { valid: true };
  }
}
