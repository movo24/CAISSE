import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { InventoryScanEntity } from '../../database/entities/inventory-scan.entity';
import { ProductEntity } from '../../database/entities/product.entity';
import { StoreEntity } from '../../database/entities/store.entity';
import { BusinessError } from '../../common/errors/business-error';
import { StockService } from '../stock/stock.service';

export interface CreateScanDto {
  barcode: string;
  quantity?: number;
  scanType?: 'inventory' | 'receiving' | 'adjustment' | 'return';
  notes?: string;
  sessionId?: string;
}

@Injectable()
export class InventoryScanService {
  private readonly logger = new Logger(InventoryScanService.name);

  constructor(
    @InjectRepository(InventoryScanEntity)
    private scanRepo: Repository<InventoryScanEntity>,
    @InjectRepository(ProductEntity)
    private productRepo: Repository<ProductEntity>,
    @InjectRepository(StoreEntity)
    private storeRepo: Repository<StoreEntity>,
    private stockService: StockService,
  ) {}

  /**
   * Record a scan — the core operation.
   * 1. Validates store exists and has a store_code
   * 2. Looks up product by barcode within this store
   * 3. Records the scan
   * 4. Optionally updates stock
   */
  async recordScan(
    storeId: string,
    employeeId: string,
    dto: CreateScanDto,
  ): Promise<InventoryScanEntity> {
    // 1. Validate store
    const store = await this.storeRepo.findOne({ where: { id: storeId } });
    if (!store) {
      throw BusinessError.notFound('Store', storeId);
    }
    if (!store.storeCode) {
      throw BusinessError.invalidRelation(
        'Ce magasin n\'a pas de code magasin. Contactez un administrateur.',
      );
    }

    // 2. Lookup product by barcode in this store
    const product = await this.productRepo.findOne({
      where: { ean: dto.barcode, storeId, isActive: true },
    });

    const status = product ? 'matched' : 'new';

    // 3. Record scan
    const scan = this.scanRepo.create({
      storeId,
      storeCode: store.storeCode,
      employeeId,
      barcode: dto.barcode,
      productId: product?.id ?? undefined,
      productName: product?.name ?? undefined,
      quantity: dto.quantity || 1,
      scanType: (dto.scanType || 'inventory') as any,
      status: status as any,
      notes: dto.notes ?? undefined,
      sessionId: dto.sessionId ?? undefined,
    });

    const saved = await this.scanRepo.save(scan);

    this.logger.log(
      `Scan recorded: ${dto.barcode} in store ${store.storeCode} — ${status} (qty: ${scan.quantity})`,
    );

    return saved;
  }

  /**
   * Apply pending scans to stock — updates product quantities for the store.
   * Only applies scans with status 'matched' and 'pending'.
   */
  async applyScansToStock(
    storeId: string,
    employeeId: string,
    sessionId?: string,
  ): Promise<{ applied: number; skipped: number }> {
    const where: any = { storeId, status: 'matched' };
    if (sessionId) where.sessionId = sessionId;

    const scans = await this.scanRepo.find({ where });
    let applied = 0;
    let skipped = 0;

    for (const scan of scans) {
      if (!scan.productId) {
        skipped++;
        continue;
      }

      try {
        if (scan.scanType === 'inventory') {
          // Inventory count: set absolute quantity
          await this.stockService.adjustStock(
            scan.productId,
            scan.quantity,
            storeId,
            employeeId,
            `Inventaire scan (session: ${scan.sessionId || 'direct'})`,
            'absolute',
          );
        } else if (scan.scanType === 'receiving') {
          // Receiving: add to stock
          await this.stockService.adjustStock(
            scan.productId,
            scan.quantity,
            storeId,
            employeeId,
            `Reception marchandise scan`,
            'delta',
          );
        } else if (scan.scanType === 'adjustment') {
          // Manual adjustment
          await this.stockService.adjustStock(
            scan.productId,
            scan.quantity,
            storeId,
            employeeId,
            `Ajustement manuel scan`,
            'delta',
          );
        } else if (scan.scanType === 'return') {
          // Return: add back to stock
          await this.stockService.adjustStock(
            scan.productId,
            scan.quantity,
            storeId,
            employeeId,
            `Retour produit scan`,
            'delta',
          );
        }

        scan.status = 'applied';
        await this.scanRepo.save(scan);
        applied++;
      } catch (err) {
        this.logger.error(`Failed to apply scan ${scan.id}: ${err}`);
        scan.status = 'rejected';
        await this.scanRepo.save(scan);
        skipped++;
      }
    }

    this.logger.log(
      `Applied ${applied} scans, skipped ${skipped} for store ${storeId}`,
    );
    return { applied, skipped };
  }

  /**
   * List scans for a store, optionally filtered.
   */
  async listScans(
    storeId: string,
    filters?: {
      sessionId?: string;
      status?: string;
      scanType?: string;
      limit?: number;
    },
  ): Promise<InventoryScanEntity[]> {
    const qb = this.scanRepo
      .createQueryBuilder('s')
      .where('s.store_id = :storeId', { storeId })
      .orderBy('s.created_at', 'DESC');

    if (filters?.sessionId) {
      qb.andWhere('s.session_id = :sessionId', { sessionId: filters.sessionId });
    }
    if (filters?.status) {
      qb.andWhere('s.status = :status', { status: filters.status });
    }
    if (filters?.scanType) {
      qb.andWhere('s.scan_type = :scanType', { scanType: filters.scanType });
    }

    qb.take(filters?.limit || 200);

    return qb.getMany();
  }

  /**
   * Get scan stats for a store session.
   */
  async getSessionStats(
    storeId: string,
    sessionId: string,
  ): Promise<{
    total: number;
    matched: number;
    newProducts: number;
    applied: number;
    pending: number;
  }> {
    const scans = await this.scanRepo.find({
      where: { storeId, sessionId },
    });

    return {
      total: scans.length,
      matched: scans.filter((s) => s.status === 'matched').length,
      newProducts: scans.filter((s) => s.status === 'new').length,
      applied: scans.filter((s) => s.status === 'applied').length,
      pending: scans.filter(
        (s) => s.status === 'pending' || s.status === 'matched',
      ).length,
    };
  }
}
