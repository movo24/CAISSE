import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import {
  AirtableOperationEntity,
  AirtableOperationStatus,
  AirtableRiskLevel,
} from '../../database/entities/airtable-operation.entity';
import { AirtableSyncLogEntity } from '../../database/entities/airtable-sync-log.entity';
import { ProductEntity } from '../../database/entities/product.entity';
import { AirtableOpsConfig } from './airtable-ops.config';
import { AirtableOpsSyncService } from './airtable-ops.sync.service';
import { ListOperationsDto } from './dto/list-operations.dto';

/** Minimum role required to approve an operation by risk level */
const APPROVAL_ROLE: Record<AirtableRiskLevel, number> = {
  low: 0,      // cashier+
  medium: 1,   // manager+
  high: 2,     // admin+
  critical: 2, // admin+ (+ enhanced audit)
};

export interface OperationsPage {
  data: AirtableOperationEntity[];
  total: number;
  page: number;
  limit: number;
}

export interface AirtableOpsStats {
  pending: number;
  approved: number;
  rejected: number;
  applied: number;
  failed: number;
  byRisk: Record<AirtableRiskLevel, number>;
}

@Injectable()
export class AirtableOpsService {
  private readonly logger = new Logger(AirtableOpsService.name);

  constructor(
    @InjectRepository(AirtableOperationEntity)
    private readonly operationRepo: Repository<AirtableOperationEntity>,
    @InjectRepository(AirtableSyncLogEntity)
    private readonly syncLogRepo: Repository<AirtableSyncLogEntity>,
    @InjectRepository(ProductEntity)
    private readonly productRepo: Repository<ProductEntity>,
    private readonly config: AirtableOpsConfig,
    private readonly syncService: AirtableOpsSyncService,
  ) {}

  // ── Queries ───────────────────────────────────────────────────────────────

  async listOperations(dto: ListOperationsDto): Promise<OperationsPage> {
    const page = dto.page ?? 1;
    const limit = dto.limit ?? 20;

    const qb = this.operationRepo.createQueryBuilder('op');

    if (dto.storeId) qb.andWhere('op.store_id = :storeId', { storeId: dto.storeId });
    if (dto.status) qb.andWhere('op.status = :status', { status: dto.status });
    if (dto.riskLevel) qb.andWhere('op.risk_level = :riskLevel', { riskLevel: dto.riskLevel });

    qb.orderBy('op.created_at', 'DESC')
      .skip((page - 1) * limit)
      .take(limit);

    const [data, total] = await qb.getManyAndCount();
    return { data, total, page, limit };
  }

  async getOperation(id: string): Promise<AirtableOperationEntity> {
    const op = await this.operationRepo.findOne({ where: { id } });
    if (!op) throw new NotFoundException(`AirtableOperation ${id} not found`);
    return op;
  }

  async getStats(storeId?: string): Promise<AirtableOpsStats> {
    const qb = this.operationRepo.createQueryBuilder('op');
    if (storeId) qb.andWhere('op.store_id = :storeId', { storeId });

    const rows = await qb
      .select('op.status', 'status')
      .addSelect('op.risk_level', 'riskLevel')
      .addSelect('COUNT(*)', 'count')
      .groupBy('op.status, op.risk_level')
      .getRawMany<{ status: string; riskLevel: string; count: string }>();

    const stats: AirtableOpsStats = {
      pending: 0,
      approved: 0,
      rejected: 0,
      applied: 0,
      failed: 0,
      byRisk: { low: 0, medium: 0, high: 0, critical: 0 },
    };

    for (const row of rows) {
      const count = parseInt(row.count, 10);
      if (row.status in stats) {
        (stats as any)[row.status] += count;
      }
      const rl = row.riskLevel as AirtableRiskLevel;
      if (rl in stats.byRisk) {
        stats.byRisk[rl] += count;
      }
    }

    return stats;
  }

  async listSyncLogs(
    storeId?: string,
    limit = 50,
  ): Promise<AirtableSyncLogEntity[]> {
    return this.syncLogRepo.find({
      where: storeId ? { storeId } : {},
      order: { createdAt: 'DESC' },
      take: limit,
    });
  }

  // ── Approval workflow ─────────────────────────────────────────────────────

  /**
   * Approve a pending operation.
   * @param id         Operation UUID
   * @param reviewerId Employee UUID (from JWT)
   * @param reviewerRole  0=cashier 1=manager 2=admin
   */
  async approveOperation(
    id: string,
    reviewerId: string,
    reviewerRole: number,
  ): Promise<AirtableOperationEntity> {
    const op = await this.getOperation(id);
    this.assertStatus(op, 'pending');
    this.assertRole(op.riskLevel, reviewerRole);

    op.status = 'approved';
    op.reviewedBy = reviewerId;
    op.reviewedAt = new Date();
    return this.operationRepo.save(op);
  }

  async rejectOperation(
    id: string,
    reviewerId: string,
    reason: string,
  ): Promise<AirtableOperationEntity> {
    const op = await this.getOperation(id);
    this.assertStatus(op, 'pending');

    op.status = 'rejected';
    op.reviewedBy = reviewerId;
    op.reviewedAt = new Date();
    op.failureReason = reason;
    return this.operationRepo.save(op);
  }

  /**
   * Apply an approved operation to the POS database.
   *
   * CRITICAL CONSTRAINTS:
   * - High/critical operations require an explicit second call — they are never
   *   auto-applied even when approved.
   * - Only `product` entityType is supported in Phase 1.
   * - The operation must already be in `approved` status.
   */
  async applyOperation(
    id: string,
    applierRole: number,
  ): Promise<AirtableOperationEntity> {
    const op = await this.getOperation(id);
    this.assertStatus(op, 'approved');
    this.assertRole(op.riskLevel, applierRole);

    // Extra guard: high/critical require admin role to apply
    if ((op.riskLevel === 'high' || op.riskLevel === 'critical') && applierRole < 2) {
      throw new ForbiddenException(
        `Applying ${op.riskLevel}-risk operations requires admin role`,
      );
    }

    try {
      if (op.entityType === 'product') {
        await this.applyProductOperation(op);
      } else {
        throw new BadRequestException(
          `entityType '${op.entityType}' not supported in Phase 1`,
        );
      }

      op.status = 'applied';
      op.appliedAt = new Date();
      return this.operationRepo.save(op);
    } catch (err: any) {
      op.status = 'failed';
      op.failureReason = err?.message ?? String(err);
      await this.operationRepo.save(op);
      throw err;
    }
  }

  // ── Manual sync trigger ───────────────────────────────────────────────────

  async triggerManualSync(storeId?: string): Promise<{ queued: boolean }> {
    if (!this.config.enabled) {
      return { queued: false };
    }

    // Fire-and-forget — response is immediate, sync runs in background
    Promise.resolve()
      .then(() => this.syncService.exportProducts(storeId, false, 'MANUAL'))
      .then(() => this.syncService.importProductSuggestions(storeId, 'MANUAL'))
      .catch((err: any) =>
        this.logger.error(`Manual sync error: ${err?.message}`),
      );

    return { queued: true };
  }

  // ── Internal helpers ──────────────────────────────────────────────────────

  private assertStatus(
    op: AirtableOperationEntity,
    expected: AirtableOperationStatus,
  ): void {
    if (op.status !== expected) {
      throw new BadRequestException(
        `Operation ${op.id} is '${op.status}', expected '${expected}'`,
      );
    }
  }

  private assertRole(riskLevel: AirtableRiskLevel, role: number): void {
    const required = APPROVAL_ROLE[riskLevel];
    if (role < required) {
      throw new ForbiddenException(
        `${riskLevel}-risk operations require role >= ${required} (you have ${role})`,
      );
    }
  }

  private async applyProductOperation(
    op: AirtableOperationEntity,
  ): Promise<void> {
    const product = await this.productRepo.findOne({
      where: { id: op.entityId },
    });
    if (!product) {
      throw new NotFoundException(`Product ${op.entityId} not found`);
    }

    // Map Airtable field name back to ProductEntity column
    const PRODUCT_ALLOWED_FIELDS: Record<string, keyof ProductEntity> = {
      isActive: 'isActive',
      priceMinorUnits: 'priceMinorUnits',
      stockQuantity: 'stockQuantity',
      // Metadata fields — not on ProductEntity yet; store in a future column
      // For now we log them but don't mutate
    };

    const entityField = PRODUCT_ALLOWED_FIELDS[op.field];
    if (entityField) {
      await this.productRepo.update(product.id, {
        [entityField]: op.proposedValue as any,
      });
      this.logger.log(
        `Applied operation ${op.id}: product ${product.id}.${entityField} → ${JSON.stringify(op.proposedValue)}`,
      );
    } else {
      // Non-DB metadata fields (publicName, SEO, tags…) — Phase 1 just logs
      this.logger.log(
        `Operation ${op.id}: field '${op.field}' is metadata-only (no DB column in Phase 1) — marked applied`,
      );
    }
  }
}
