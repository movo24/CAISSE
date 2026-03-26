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

  // ─── MOVEMENTS (the core) ─────────────────────────────────────

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
  }): Promise<StockMovementEntity> {
    if (data.quantity <= 0) throw new BadRequestException('Quantity must be positive');

    return this.dataSource.transaction(async (manager) => {
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
      return saved;
    });
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
  }): Promise<StockMovementEntity> {
    if (data.quantity <= 0) throw new BadRequestException('Quantity must be positive');
    if (data.fromLocationId === data.toLocationId) {
      throw new BadRequestException('Cannot transfer to same location');
    }

    return this.dataSource.transaction(async (manager) => {
      // Lock source balance
      let fromBalance = await manager.findOne(StockBalanceEntity, {
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
      return saved;
    });
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
  }): Promise<StockMovementEntity[]> {
    const totalQty = data.dispatches.reduce((s, d) => s + d.quantity, 0);
    if (totalQty <= 0) throw new BadRequestException('Total dispatch quantity must be positive');

    return this.dataSource.transaction(async (manager) => {
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

      const movements: StockMovementEntity[] = [];

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
      }

      await manager.save(fromBalance);
      await this.syncLegacyStock(manager, data.productId);

      this.logger.log(
        `Dispatched ${totalQty}x product ${data.productId} to ${data.dispatches.length} locations`,
      );
      return movements;
    });
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
