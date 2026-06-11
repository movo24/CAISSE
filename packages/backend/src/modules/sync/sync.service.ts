import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, MoreThan, DataSource, In } from 'typeorm';
import { SaleEntity } from '../../database/entities/sale.entity';
import { ProductEntity } from '../../database/entities/product.entity';
import { CustomerEntity } from '../../database/entities/customer.entity';
import { AuditService } from '../audit/audit.service';

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
  resolution: 'server_wins' | 'client_wins' | 'manual';
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

    // --- (H4) Offline sales are NOT accepted in V1 — ONLINE-ONLY. ---
    // A sale must be created online via POST /sales so it is sealed into the
    // per-store fiscal hash chain (stores FOR UPDATE lock + prevHash + sha256
    // in createSale). A raw insert here would land hash-less and off-chain,
    // FORKING the chain — there must be a SINGLE sealing path into `sales`.
    // The full offline-sealing subsystem (re-seal server-side, in order, at
    // sync) is deferred; until then this door is closed fail-closed. Customer
    // and stock sync below remain open (not hash-chained fiscal records).
    if (payload.sales && payload.sales.length > 0) {
      throw new BadRequestException(
        'Offline sales are not accepted (online-only V1). A sale must be ' +
          'created online via POST /sales so it is sealed into the fiscal ' +
          'hash chain.',
      );
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
      // 1. Sales — intentionally NOT processed here (H4, online-only V1).
      //    The raw `manager.save(SaleEntity, …)` that used to live here was the
      //    second, UN-SEALED write door into `sales` (no hash chain, no store
      //    lock) — it forked the fiscal chain. It has been removed; offline
      //    sales are rejected at the input-validation gate above. A future
      //    offline subsystem must re-seal through createSale's path, never raw.

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

          if (existing && existing.updatedAt > sinceDate) {
            conflicts.push({
              entity: 'customer',
              entityId: customer.id,
              field: 'loyaltyPoints',
              localValue: customer.loyaltyPoints,
              serverValue: existing.loyaltyPoints,
              resolution: 'server_wins',
            });
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
        await queryRunner.manager
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
