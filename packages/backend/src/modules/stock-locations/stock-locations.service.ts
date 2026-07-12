import {
  Injectable, Logger, BadRequestException, NotFoundException, ForbiddenException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { StockLocationEntity } from '../../database/entities/stock-location.entity';
import { StockBalanceEntity } from '../../database/entities/stock-balance.entity';
import { StockMovementEntity } from '../../database/entities/stock-movement.entity';
import { ProductEntity } from '../../database/entities/product.entity';
import { AuditService } from '../audit/audit.service';

/**
 * StockLocationsService — Multi-location stock management.
 *
 * Core operations:
 * - Manage locations (central, stores)
 * - Receive stock from supplier → central
 * - Dispatch stock central → stores
 * - Transfer between stores
 * - Record sales (decrement)
 * - Full movement journal
 */
@Injectable()
export class StockLocationsService {
  private readonly logger = new Logger('StockLocations');

  constructor(
    @InjectRepository(StockLocationEntity)
    private readonly locationRepo: Repository<StockLocationEntity>,
    @InjectRepository(StockBalanceEntity)
    private readonly balanceRepo: Repository<StockBalanceEntity>,
    @InjectRepository(StockMovementEntity)
    private readonly movementRepo: Repository<StockMovementEntity>,
    @InjectRepository(ProductEntity)
    private readonly productRepo: Repository<ProductEntity>,
    private readonly dataSource: DataSource,
    private readonly auditService: AuditService,
  ) {}

  // ─── LOCATIONS ─────────────────────────────────────────────────

  async createLocation(data: {
    name: string;
    code: string;
    type: 'central' | 'store' | 'transit' | 'loss';
    storeId?: string;
    address?: string;
  }): Promise<StockLocationEntity> {
    const existing = await this.locationRepo.findOne({ where: { code: data.code } });
    if (existing) throw new BadRequestException(`Location code ${data.code} already exists`);

    const location = new StockLocationEntity();
    location.name = data.name;
    location.code = data.code.toUpperCase();
    location.type = data.type;
    location.storeId = data.storeId || null;
    location.address = data.address || '';
    const saved = await this.locationRepo.save(location);
    this.logger.log(`Location created: ${saved.code} (${saved.type})`);
    return saved;
  }

  async listLocations(): Promise<StockLocationEntity[]> {
    return this.locationRepo.find({
      where: { isActive: true },
      order: { type: 'ASC', name: 'ASC' },
    });
  }

  async getLocation(id: string): Promise<StockLocationEntity> {
    const loc = await this.locationRepo.findOne({ where: { id } });
    if (!loc) throw new NotFoundException('Location not found');
    return loc;
  }

  async findCentral(): Promise<StockLocationEntity | null> {
    return this.locationRepo.findOne({ where: { type: 'central', isActive: true } });
  }

  // ─── STOCK BALANCES ────────────────────────────────────────────

  async getBalance(productId: string, locationId: string): Promise<number> {
    const bal = await this.balanceRepo.findOne({ where: { productId, locationId } });
    return bal?.quantity ?? 0;
  }

  async getBalancesForProduct(productId: string): Promise<StockBalanceEntity[]> {
    return this.balanceRepo.find({
      where: { productId },
      relations: ['location'],
      order: { quantity: 'DESC' },
    });
  }

  async getBalancesForLocation(locationId: string): Promise<StockBalanceEntity[]> {
    return this.balanceRepo.find({
      where: { locationId },
      relations: ['product'],
      order: { quantity: 'DESC' },
    });
  }

  async getNetworkStock(): Promise<{
    locationId: string;
    locationName: string;
    locationCode: string;
    locationType: string;
    productId: string;
    productName: string;
    ean: string;
    quantity: number;
  }[]> {
    return this.dataSource.query(`
      SELECT
        sb.location_id as "locationId",
        sl.name as "locationName",
        sl.code as "locationCode",
        sl.type as "locationType",
        sb.product_id as "productId",
        p.name as "productName",
        p.ean,
        sb.quantity
      FROM stock_balances sb
      JOIN stock_locations sl ON sl.id = sb.location_id
      JOIN products p ON p.id = sb.product_id
      WHERE sl.is_active = true
      ORDER BY p.name, sl.type, sl.name
    `);
  }

  /**
   * M107 — READ-ONLY divergence diagnostic. Reports products whose legacy
   * `products.stock_quantity` disagrees with `SUM(stock_balances.quantity)`.
   *
   * Sales decrement the legacy column directly while stock-locations ops overwrite it
   * with SUM(balances) via syncLegacyStock → the two can silently diverge. This is the
   * gap report (no mutation, no correction). Only products that HAVE balance rows are
   * considered (INNER JOIN) — legacy-only products are not "diverged", they simply
   * don't use multi-location. A one-shot reconciliation that WRITES stock is a separate,
   * prod-validated step (it touches real stock).
   */
  async findStockDivergences(storeId?: string): Promise<{
    productId: string;
    ean: string;
    name: string;
    storeId: string;
    legacyQuantity: number;
    balancesQuantity: number;
    delta: number;
  }[]> {
    const where = storeId ? 'WHERE p.store_id = $1' : '';
    const params = storeId ? [storeId] : [];
    // SQL kept to plain SUM + GROUP BY (no arithmetic/HAVING/ORDER-BY-expr) so it
    // behaves identically on real PG and the pg-mem test harness; the divergence
    // filter, delta and sort are computed in JS.
    const rows = await this.dataSource.query(
      `SELECT p.id AS "productId", p.ean, p.name, p.store_id AS "storeId",
              p.stock_quantity AS "legacyQuantity",
              SUM(sb.quantity) AS "balancesQuantity"
         FROM products p
         JOIN stock_balances sb ON sb.product_id = p.id
         ${where}
         GROUP BY p.id, p.ean, p.name, p.store_id, p.stock_quantity`,
      params,
    );
    return (Array.isArray(rows) ? rows : [])
      .map((r: any) => {
        const legacyQuantity = Number(r.legacyQuantity);
        const balancesQuantity = Number(r.balancesQuantity);
        return {
          productId: r.productId,
          ean: r.ean,
          name: r.name,
          storeId: r.storeId,
          legacyQuantity,
          balancesQuantity,
          delta: legacyQuantity - balancesQuantity,
        };
      })
      .filter((r) => r.delta !== 0)
      .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  }

  /**
   * Tenant guard for stock operations: a non-admin actor may only move products
   * belonging to their own store. Products always carry a concrete storeId, so
   * this is independent of the (store-null) central/transit location model and
   * never blocks a legitimate central→store dispatch of the store's own product.
   * Skipped when no actor context is supplied (internal/trusted calls) or for admins.
   */
  private async assertProductOwned(
    productId: string,
    actorStoreId?: string,
    actorRole?: string,
  ): Promise<void> {
    if (!actorStoreId || actorRole === 'admin') return;
    const product = await this.productRepo.findOne({
      where: { id: productId },
      select: { id: true, storeId: true },
    });
    if (!product || product.storeId !== actorStoreId) {
      throw new ForbiddenException(
        "Accès refusé : ce produit n'appartient pas à votre magasin.",
      );
    }
  }

  // ─── MOVEMENTS (the core) ─────────────────────────────────────

  /**
   * D20 — audit a committed stock movement, OUT-OF-BAND and BEST-EFFORT.
   *
   * The 4 movement methods below wrote the operational stock journal
   * (`stock_movements`) but left NO audit trail — `AuditService` was injected
   * yet never called (dead injection). This restores traceability of who moved
   * what, where and by how much (supplier receipt / transfer / loss / dispatch).
   *
   * Per the ratified D16/D17 model, `AuditService` is the APPLICATIVE audit
   * chain: out-of-band, post-commit, best-effort. A failure here must NEVER roll
   * back or fail a movement that already committed — it only warns. This is the
   * operational stock journal, NOT the fiscal chain (`fiscal_journal`).
   *
   * `storeId` is resolved from the moved product (products always carry a
   * concrete storeId), so the audit is correctly tenant-scoped even for admin
   * actors whose JWT store may differ from the product's store.
   */
  private async auditMovement(params: {
    productId: string;
    entityId: string;
    action: string;
    employeeId: string;
    details: Record<string, unknown>;
  }): Promise<void> {
    try {
      const product = await this.productRepo.findOne({
        where: { id: params.productId },
        select: { id: true, storeId: true },
      });
      await this.auditService.log({
        storeId: product?.storeId ?? '',
        employeeId: params.employeeId,
        action: params.action,
        entityType: 'stock_movement',
        entityId: params.entityId,
        details: params.details,
      });
    } catch (auditErr: any) {
      this.logger.warn(`Audit (${params.action}) failed: ${auditErr?.message}`);
    }
  }

  /**
   * Receive stock from supplier into a location (usually central).
   */
  async receiveFromSupplier(data: {
    productId: string;
    locationId: string;
    quantity: number;
    reference?: string;
    reason?: string;
    employeeId: string;
    employeeName: string;
    actorStoreId?: string;
    actorRole?: string;
  }): Promise<StockMovementEntity> {
    if (data.quantity <= 0) throw new BadRequestException('Quantity must be positive');
    await this.assertProductOwned(data.productId, data.actorStoreId, data.actorRole);

    const { saved, oldBalance, newBalance } = await this.dataSource.transaction(
      async (manager) => {
        // Update or create balance
        let balance = await manager.findOne(StockBalanceEntity, {
          where: { productId: data.productId, locationId: data.locationId },
          lock: { mode: 'pessimistic_write' },
        });

        if (!balance) {
          balance = Object.assign(new StockBalanceEntity(), {
            productId: data.productId,
            locationId: data.locationId,
            quantity: 0,
          });
        }

        const oldBalance = balance.quantity;
        balance.quantity += data.quantity;
        await manager.save(balance);

        // Create movement
        const movement = Object.assign(new StockMovementEntity(), {
          productId: data.productId,
          movementType: 'supplier_receipt',
          fromLocationId: null,
          toLocationId: data.locationId,
          quantity: data.quantity,
          reference: data.reference || null,
          reason: data.reason || 'Réception fournisseur',
          employeeId: data.employeeId,
          employeeName: data.employeeName,
        });
        const saved = await manager.save(movement);

        // Also update legacy product.stockQuantity for backward compatibility
        await this.syncLegacyStock(manager, data.productId);

        this.logger.log(
          `Received ${data.quantity}x product ${data.productId} at location ${data.locationId}`,
        );
        return { saved, oldBalance, newBalance: balance.quantity };
      },
    );

    await this.auditMovement({
      productId: data.productId,
      entityId: saved.id,
      action: 'stock_supplier_receipt',
      employeeId: data.employeeId,
      details: {
        movementType: 'supplier_receipt',
        toLocationId: data.locationId,
        quantity: data.quantity,
        oldBalance,
        newBalance,
        reference: data.reference ?? null,
        reason: data.reason ?? 'Réception fournisseur',
        employeeName: data.employeeName,
      },
    });

    return saved;
  }

  /**
   * Transfer stock between locations.
   */
  async transfer(data: {
    productId: string;
    fromLocationId: string;
    toLocationId: string;
    quantity: number;
    reference?: string;
    reason?: string;
    employeeId: string;
    employeeName: string;
    actorStoreId?: string;
    actorRole?: string;
  }): Promise<StockMovementEntity> {
    if (data.quantity <= 0) throw new BadRequestException('Quantity must be positive');
    if (data.fromLocationId === data.toLocationId) {
      throw new BadRequestException('Cannot transfer to same location');
    }
    await this.assertProductOwned(data.productId, data.actorStoreId, data.actorRole);

    const { saved, fromOldBalance, fromNewBalance, toOldBalance, toNewBalance } =
      await this.dataSource.transaction(async (manager) => {
        // Lock source balance
        const fromBalance = await manager.findOne(StockBalanceEntity, {
          where: { productId: data.productId, locationId: data.fromLocationId },
          lock: { mode: 'pessimistic_write' },
        });

        if (!fromBalance || fromBalance.quantity < data.quantity) {
          const available = fromBalance?.quantity ?? 0;
          throw new BadRequestException(
            `Insufficient stock: ${available} available, ${data.quantity} requested`,
          );
        }

        // Lock or create destination balance
        let toBalance = await manager.findOne(StockBalanceEntity, {
          where: { productId: data.productId, locationId: data.toLocationId },
          lock: { mode: 'pessimistic_write' },
        });

        if (!toBalance) {
          toBalance = Object.assign(new StockBalanceEntity(), {
            productId: data.productId,
            locationId: data.toLocationId,
            quantity: 0,
          });
        }

        const fromOldBalance = fromBalance.quantity;
        const toOldBalance = toBalance.quantity;
        fromBalance.quantity -= data.quantity;
        toBalance.quantity += data.quantity;
        await manager.save([fromBalance, toBalance]);

        // Create movement
        const movement = Object.assign(new StockMovementEntity(), {
          productId: data.productId,
          movementType: 'transfer',
          fromLocationId: data.fromLocationId,
          toLocationId: data.toLocationId,
          quantity: data.quantity,
          reference: data.reference || null,
          reason: data.reason || 'Transfert',
          employeeId: data.employeeId,
          employeeName: data.employeeName,
        });
        const saved = await manager.save(movement);

        // Sync legacy stock
        await this.syncLegacyStock(manager, data.productId);

        this.logger.log(
          `Transferred ${data.quantity}x product ${data.productId}: ${data.fromLocationId} → ${data.toLocationId}`,
        );
        return {
          saved,
          fromOldBalance,
          fromNewBalance: fromBalance.quantity,
          toOldBalance,
          toNewBalance: toBalance.quantity,
        };
      });

    await this.auditMovement({
      productId: data.productId,
      entityId: saved.id,
      action: 'stock_transfer',
      employeeId: data.employeeId,
      details: {
        movementType: 'transfer',
        fromLocationId: data.fromLocationId,
        toLocationId: data.toLocationId,
        quantity: data.quantity,
        fromOldBalance,
        fromNewBalance,
        toOldBalance,
        toNewBalance,
        reference: data.reference ?? null,
        reason: data.reason ?? 'Transfert',
        employeeName: data.employeeName,
      },
    });

    return saved;
  }

  /**
   * Record a stock LOSS at a location (Bloc 6.2) — casse, vol, périmé, inconnu.
   * The movement types existed in the journal but were unreachable. A loss
   * decrements the location balance and writes an immutable loss movement
   * (from=location, to=null); a reason is REQUIRED (operational accountability).
   * Non-fiscal: this is the operational stock journal, not the fiscal chain.
   */
  async recordLoss(data: {
    productId: string;
    locationId: string;
    quantity: number;
    lossType: 'loss_breakage' | 'loss_theft' | 'loss_expired' | 'loss_unknown';
    reason: string;
    employeeId: string;
    employeeName: string;
    actorStoreId?: string;
    actorRole?: string;
  }): Promise<StockMovementEntity> {
    if (data.quantity <= 0) throw new BadRequestException('Quantity must be positive');
    if (!data.reason || !data.reason.trim()) {
      throw new BadRequestException('A loss requires a reason (casse / vol / périmé / …)');
    }
    const allowed = ['loss_breakage', 'loss_theft', 'loss_expired', 'loss_unknown'];
    if (!allowed.includes(data.lossType)) {
      throw new BadRequestException(`Invalid loss type: ${data.lossType}`);
    }
    await this.assertProductOwned(data.productId, data.actorStoreId, data.actorRole);

    const { saved, oldBalance, newBalance } = await this.dataSource.transaction(
      async (manager) => {
        const balance = await manager.findOne(StockBalanceEntity, {
          where: { productId: data.productId, locationId: data.locationId },
          lock: { mode: 'pessimistic_write' },
        });
        if (!balance || balance.quantity < data.quantity) {
          const available = balance?.quantity ?? 0;
          throw new BadRequestException(
            `Insufficient stock to write off: ${available} available, ${data.quantity} requested`,
          );
        }

        const oldBalance = balance.quantity;
        balance.quantity -= data.quantity;
        await manager.save(balance);

        const movement = Object.assign(new StockMovementEntity(), {
          productId: data.productId,
          movementType: data.lossType,
          fromLocationId: data.locationId,
          toLocationId: null,
          quantity: data.quantity,
          reason: data.reason.trim(),
          employeeId: data.employeeId,
          employeeName: data.employeeName,
        });
        const saved = await manager.save(movement);

        await this.syncLegacyStock(manager, data.productId);

        this.logger.log(
          `Loss ${data.lossType} ${data.quantity}x product ${data.productId} at ${data.locationId}: ${data.reason}`,
        );
        return { saved, oldBalance, newBalance: balance.quantity };
      },
    );

    await this.auditMovement({
      productId: data.productId,
      entityId: saved.id,
      action: 'stock_loss',
      employeeId: data.employeeId,
      details: {
        movementType: data.lossType,
        fromLocationId: data.locationId,
        quantity: data.quantity,
        oldBalance,
        newBalance,
        lossType: data.lossType,
        reason: data.reason.trim(),
        employeeName: data.employeeName,
      },
    });

    return saved;
  }

  /**
   * Dispatch from central to multiple stores at once.
   */
  async dispatch(data: {
    productId: string;
    fromLocationId: string;
    dispatches: { toLocationId: string; quantity: number }[];
    reference?: string;
    employeeId: string;
    employeeName: string;
    actorStoreId?: string;
    actorRole?: string;
  }): Promise<StockMovementEntity[]> {
    const totalQty = data.dispatches.reduce((s, d) => s + d.quantity, 0);
    if (totalQty <= 0) throw new BadRequestException('Total dispatch quantity must be positive');
    await this.assertProductOwned(data.productId, data.actorStoreId, data.actorRole);

    const { movements, fromOldBalance, fromNewBalance, applied } =
      await this.dataSource.transaction(async (manager) => {
        // Lock source
        const fromBalance = await manager.findOne(StockBalanceEntity, {
          where: { productId: data.productId, locationId: data.fromLocationId },
          lock: { mode: 'pessimistic_write' },
        });

        if (!fromBalance || fromBalance.quantity < totalQty) {
          throw new BadRequestException(
            `Insufficient stock: ${fromBalance?.quantity ?? 0} available, ${totalQty} requested for dispatch`,
          );
        }

        const fromOldBalance = fromBalance.quantity;
        const movements: StockMovementEntity[] = [];
        const applied: { toLocationId: string; quantity: number }[] = [];

        for (const d of data.dispatches) {
          if (d.quantity <= 0) continue;

          // Update or create destination
          let toBalance = await manager.findOne(StockBalanceEntity, {
            where: { productId: data.productId, locationId: d.toLocationId },
            lock: { mode: 'pessimistic_write' },
          });

          if (!toBalance) {
            toBalance = Object.assign(new StockBalanceEntity(), {
              productId: data.productId,
              locationId: d.toLocationId,
              quantity: 0,
            });
          }

          fromBalance.quantity -= d.quantity;
          toBalance.quantity += d.quantity;
          await manager.save(toBalance);

          const movement = Object.assign(new StockMovementEntity(), {
            productId: data.productId,
            movementType: 'transfer',
            fromLocationId: data.fromLocationId,
            toLocationId: d.toLocationId,
            quantity: d.quantity,
            reference: data.reference || null,
            reason: 'Dispatch réseau',
            employeeId: data.employeeId,
            employeeName: data.employeeName,
          });
          movements.push(await manager.save(movement));
          applied.push({ toLocationId: d.toLocationId, quantity: d.quantity });
        }

        await manager.save(fromBalance);
        await this.syncLegacyStock(manager, data.productId);

        this.logger.log(
          `Dispatched ${totalQty}x product ${data.productId} to ${data.dispatches.length} locations`,
        );
        return {
          movements,
          fromOldBalance,
          fromNewBalance: fromBalance.quantity,
          applied,
        };
      });

    await this.auditMovement({
      productId: data.productId,
      entityId: data.productId,
      action: 'stock_dispatch',
      employeeId: data.employeeId,
      details: {
        movementType: 'dispatch',
        fromLocationId: data.fromLocationId,
        totalQuantity: applied.reduce((s, a) => s + a.quantity, 0),
        dispatches: applied,
        movementIds: movements.map((m) => m.id),
        fromOldBalance,
        fromNewBalance,
        reference: data.reference ?? null,
        employeeName: data.employeeName,
      },
    });

    return movements;
  }

  /**
   * Get movement history for a product.
   */
  async getMovements(productId: string, limit = 50): Promise<StockMovementEntity[]> {
    return this.movementRepo.find({
      where: { productId },
      relations: ['fromLocation', 'toLocation'],
      order: { createdAt: 'DESC' },
      take: limit,
    });
  }

  /**
   * Get all movements for a location.
   */
  async getLocationMovements(locationId: string, limit = 50): Promise<StockMovementEntity[]> {
    return this.dataSource.query(`
      SELECT sm.*,
        fl.name as "fromLocationName", fl.code as "fromLocationCode",
        tl.name as "toLocationName", tl.code as "toLocationCode",
        p.name as "productName", p.ean as "productEan"
      FROM stock_movements sm
      LEFT JOIN stock_locations fl ON fl.id = sm.from_location_id
      LEFT JOIN stock_locations tl ON tl.id = sm.to_location_id
      JOIN products p ON p.id = sm.product_id
      WHERE sm.from_location_id = $1 OR sm.to_location_id = $1
      ORDER BY sm.created_at DESC
      LIMIT $2
    `, [locationId, limit]);
  }

  // ─── LEGACY SYNC ──────────────────────────────────────────────

  /**
   * Sync product.stockQuantity with sum of all store-type balances.
   * Keeps backward compatibility with existing POS that reads stockQuantity.
   */
  private async syncLegacyStock(manager: any, productId: string): Promise<void> {
    const result = await manager.query(`
      SELECT COALESCE(SUM(sb.quantity), 0) as total
      FROM stock_balances sb
      JOIN stock_locations sl ON sl.id = sb.location_id
      WHERE sb.product_id = $1 AND sl.type = 'store'
    `, [productId]);

    const total = parseInt(result[0]?.total ?? '0', 10);
    await manager.query(
      `UPDATE products SET stock_quantity = $1 WHERE id = $2`,
      [total, productId],
    );
  }
}
