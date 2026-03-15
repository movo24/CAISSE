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
    // Get last entry for hash chain
    const lastEntry = await this.auditRepo.findOne({
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

    const entry = this.auditRepo.create({
      id: uuidv4(),
      ...params,
      previousHash,
      currentHash,
    });

    return this.auditRepo.save(entry);
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
