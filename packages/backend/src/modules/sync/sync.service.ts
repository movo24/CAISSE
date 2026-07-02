import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, MoreThan, DataSource, In } from 'typeorm';
import { SaleEntity } from '../../database/entities/sale.entity';
import { ProductEntity } from '../../database/entities/product.entity';
import { CustomerEntity } from '../../database/entities/customer.entity';
import { AuditService } from '../audit/audit.service';
import { resolveCustomerSync, partitionPushSales } from './conflict';
import { recordAdjustMovement } from '../stock/stock-movement-journal';

// ---------------------------------------------------------------------------
// Sync payload interfaces
// ---------------------------------------------------------------------------
export interface SyncPushPayload {
  storeId: string;
  deviceId: string;
  lastSyncAt: string; // ISO 8601
  sales: Partial<SaleEntity>[];
  customers: Partial<CustomerEntity>[];
  stockAdjustments: {
    productId: string;
    delta: number;
    reason: string;
  }[];
}

export interface SyncPullResponse {
  serverTimestamp: string;
  products: ProductEntity[];
  customers: CustomerEntity[];
  conflicts: SyncConflict[];
}

export interface SyncConflict {
  entity: string;
  entityId: string;
  field: string;
  localValue: unknown;
  serverValue: unknown;
  resolution: 'server_wins' | 'client_wins' | 'manual' | 'rejected_no_id';
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------
@Injectable()
export class SyncService {
  private readonly logger = new Logger(SyncService.name);

  constructor(
    @InjectRepository(SaleEntity)
    private readonly salesRepo: Repository<SaleEntity>,

    @InjectRepository(ProductEntity)
    private readonly productsRepo: Repository<ProductEntity>,

    @InjectRepository(CustomerEntity)
    private readonly customersRepo: Repository<CustomerEntity>,

    private readonly dataSource: DataSource,
    private readonly auditService: AuditService,
  ) {}

  // -----------------------------------------------------------------------
  // Push — POS sends offline data to server
  // Wrapped in a single DB transaction for atomicity.
  // Uses batched queries instead of N+1 loops.
  // -----------------------------------------------------------------------
  async push(payload: SyncPushPayload): Promise<{
    accepted: number;
    conflicts: SyncConflict[];
  }> {
    // --- Input validation ---
    if (!payload.storeId || !payload.deviceId) {
      throw new BadRequestException('storeId and deviceId are required');
    }
    for (const adj of payload.stockAdjustments) {
      if (!Number.isInteger(adj.delta)) {
        throw new BadRequestException(
          `Stock delta must be an integer, got: ${adj.delta}`,
        );
      }
      if (Math.abs(adj.delta) > 100_000) {
        throw new BadRequestException(
          `Stock delta out of range: ${adj.delta}`,
        );
      }
    }

    const conflicts: SyncConflict[] = [];
    let accepted = 0;

    // --- Run everything in a single transaction ---
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      // 1. Batch-deduplicate sales
      //    Collect all IDs, do ONE query to find existing, then bulk insert new ones
      if (payload.sales.length > 0) {
        // POS-INT-136 — idempotency requires a client id. Sales without one cannot
        // be deduped and would duplicate on replay → reject (report), never insert.
        const { withId: idSales, rejected: noIdSales } = partitionPushSales(payload.sales);
        for (const _ of noIdSales) {
          conflicts.push({
            entity: 'sale',
            entityId: '',
            field: 'id',
            localValue: null,
            serverValue: null,
            resolution: 'rejected_no_id',
          });
        }

        const saleIds = idSales.map((s) => s.id).filter((id): id is string => !!id);

        const existingIds = new Set<string>();
        if (saleIds.length > 0) {
          const existing = await queryRunner.manager.find(SaleEntity, {
            where: { id: In(saleIds) },
            select: ['id'],
          });
          existing.forEach((e) => existingIds.add(e.id));
        }

        const newSales = idSales.filter(
          (s) => !existingIds.has(s.id as string),
        );
        if (newSales.length > 0) {
          // Batch insert in chunks of 100 to avoid hitting param limits
          const CHUNK_SIZE = 100;
          for (let i = 0; i < newSales.length; i += CHUNK_SIZE) {
            const chunk = newSales.slice(i, i + CHUNK_SIZE);
            await queryRunner.manager.save(SaleEntity, chunk);
          }
          accepted += newSales.length;
        }

        if (existingIds.size > 0) {
          this.logger.debug(
            `Skipped ${existingIds.size} duplicate sales`,
          );
        }
      }

      // 2. Batch-check customer conflicts
      if (payload.customers.length > 0) {
        const customerIds = payload.customers
          .map((c) => c.id)
          .filter((id): id is string => !!id);

        const sinceDate = new Date(payload.lastSyncAt);
        const existingCustomers =
          customerIds.length > 0
            ? await queryRunner.manager.find(CustomerEntity, {
                where: { id: In(customerIds) },
              })
            : [];

        const existingMap = new Map(existingCustomers.map((c) => [c.id, c]));

        const toSave: Partial<CustomerEntity>[] = [];
        for (const customer of payload.customers) {
          if (!customer.id) continue;
          const existing = existingMap.get(customer.id);

          // POS-049/086 — pure, unit-tested conflict resolution (server-wins).
          const decision = resolveCustomerSync(
            { id: customer.id, loyaltyPoints: customer.loyaltyPoints },
            existing,
            sinceDate,
          );
          if (decision.conflict) {
            conflicts.push(decision.conflict as any);
          } else {
            toSave.push(customer);
          }
        }

        if (toSave.length > 0) {
          await queryRunner.manager.save(CustomerEntity, toSave);
          accepted += toSave.length;
        }
      }

      // 3. Stock adjustments — parameterized query (no SQL injection)
      for (const adj of payload.stockAdjustments) {
        const res = await queryRunner.manager
          .createQueryBuilder()
          .update(ProductEntity)
          .set({
            stockQuantity: () => `"stock_quantity" + :delta`,
          })
          .where('id = :id AND store_id = :storeId', {
            id: adj.productId,
            storeId: payload.storeId,
            delta: adj.delta,
          })
          .execute();
        // P306 (option 1): journal append-only du delta offline, même transaction —
        // uniquement si la ligne du BON magasin a réellement été touchée.
        if ((res.affected ?? 0) > 0) {
          await recordAdjustMovement(queryRunner.manager, {
            storeId: payload.storeId,
            actor: { employeeId: payload.deviceId, employeeName: `device:${payload.deviceId}` },
            productId: adj.productId,
            deltaQuantity: adj.delta,
            reason: `Sync offline: ${adj.reason}`.slice(0, 500),
          });
        }
        accepted++;
      }

      // Commit transaction
      await queryRunner.commitTransaction();
    } catch (error: any) {
      await queryRunner.rollbackTransaction();
      this.logger.error(`Sync push failed: ${error?.message}`, error?.stack);
      throw error;
    } finally {
      await queryRunner.release();
    }

    // Audit (outside transaction — audit is append-only, failure here is non-critical)
    try {
      await this.auditService.log({
        storeId: payload.storeId,
        employeeId: 'system',
        action: 'sync_push' as any,
        entityType: 'sync',
        entityId: payload.deviceId,
        details: {
          salesCount: payload.sales.length,
          customersCount: payload.customers.length,
          stockAdjustments: payload.stockAdjustments.length,
          accepted,
          conflicts: conflicts.length,
        },
      });
    } catch (auditError: any) {
      this.logger.warn(`Audit log failed for sync push: ${auditError?.message}`);
    }

    this.logger.log(
      `Sync push from ${payload.deviceId}: ${accepted} accepted, ${conflicts.length} conflicts`,
    );

    return { accepted, conflicts };
  }

  // -----------------------------------------------------------------------
  // Pull — POS fetches server changes since last sync
  // Uses parallel queries for products + customers
  // -----------------------------------------------------------------------
  async pull(
    storeId: string,
    lastSyncAt: string,
  ): Promise<SyncPullResponse> {
    const since = new Date(lastSyncAt);

    const [products, customers] = await Promise.all([
      this.productsRepo.find({
        where: { storeId, updatedAt: MoreThan(since) },
      }),
      this.customersRepo.find({
        where: { storeId, updatedAt: MoreThan(since) },
      }),
    ]);

    return {
      serverTimestamp: new Date().toISOString(),
      products,
      customers,
      conflicts: [],
    };
  }

  // -----------------------------------------------------------------------
  // Status — check sync health (parallel counts)
  // -----------------------------------------------------------------------
  async getStatus(storeId: string) {
    const [totalProducts, totalCustomers, totalSales] = await Promise.all([
      this.productsRepo.count({ where: { storeId } }),
      this.customersRepo.count({ where: { storeId } }),
      this.salesRepo.count({ where: { storeId } }),
    ]);

    return {
      storeId,
      serverTimestamp: new Date().toISOString(),
      counts: {
        products: totalProducts,
        customers: totalCustomers,
        sales: totalSales,
      },
      status: 'healthy',
    };
  }
}
