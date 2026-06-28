import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { InventoryScanEntity } from '../../database/entities/inventory-scan.entity';
import { ProductEntity } from '../../database/entities/product.entity';
import { StoreEntity } from '../../database/entities/store.entity';
import { BusinessError } from '../../common/errors/business-error';
import { StockService } from '../stock/stock.service';
import { CreateInventoryScanDto } from '../../common/dto';
import { applyStockAdjustment } from './inventory-adjust';

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
    private dataSource: DataSource,
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
    dto: CreateInventoryScanDto,
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

    // 1b. Idempotence : un scan rejoué (même clientEntryId) ne crée pas de
    // doublon — on renvoie l'enregistrement déjà persisté. Couvre le cas
    // « réponse 2xx perdue » de la sync offline mobile.
    if (dto.clientEntryId) {
      const existing = await this.scanRepo.findOne({
        where: { storeId, clientEntryId: dto.clientEntryId },
      });
      if (existing) {
        this.logger.log(
          `Scan idempotent: clientEntryId=${dto.clientEntryId} déjà enregistré (${existing.id})`,
        );
        return existing;
      }
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
      clientEntryId: dto.clientEntryId ?? undefined,
    });

    const saved = await this.scanRepo.save(scan);

    this.logger.log(
      `Scan recorded: ${dto.barcode} in store ${store.storeCode} — ${status} (qty: ${scan.quantity})`,
    );

    return saved;
  }

  /**
   * Apply pending scans to stock — ATOMIC: all-or-nothing.
   * Wraps all stock adjustments + scan status updates in a single transaction.
   * If ANY scan fails, the entire batch is rolled back.
   */
  async applyScansToStock(
    storeId: string,
    employeeId: string,
    sessionId?: string,
  ): Promise<{ applied: number; skipped: number }> {
    const where: any = { storeId, status: 'matched' };
    if (sessionId) where.sessionId = sessionId;

    const scans = await this.scanRepo.find({ where });

    if (scans.length === 0) {
      return { applied: 0, skipped: 0 };
    }

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    let applied = 0;
    let skipped = 0;

    try {
      for (const scan of scans) {
        if (!scan.productId) {
          skipped++;
          continue;
        }

        const modeMap: Record<string, { mode: 'absolute' | 'delta'; reason: string }> = {
          inventory:  { mode: 'absolute', reason: `Inventaire scan (session: ${scan.sessionId || 'direct'})` },
          receiving:  { mode: 'delta',    reason: 'Reception marchandise scan' },
          adjustment: { mode: 'delta',    reason: 'Ajustement manuel scan' },
          return:     { mode: 'delta',    reason: 'Retour produit scan' },
        };

        const config = modeMap[scan.scanType];
        if (!config) {
          skipped++;
          continue;
        }

        // Lock product row + update stock within transaction
        const product = await queryRunner.manager.findOne(ProductEntity, {
          where: { id: scan.productId, storeId },
          lock: { mode: 'pessimistic_write' },
        });

        if (!product) {
          skipped++;
          continue;
        }

        const oldQty = product.stockQuantity ?? 0;
        product.stockQuantity = applyStockAdjustment(
          config.mode,
          oldQty,
          scan.quantity,
        );

        await queryRunner.manager.save(ProductEntity, product);

        // Mark scan as applied
        scan.status = 'applied';
        await queryRunner.manager.save(InventoryScanEntity, scan);
        applied++;
      }

      await queryRunner.commitTransaction();

      this.logger.log(
        `Applied ${applied} scans atomically, skipped ${skipped} for store ${storeId}`,
      );
    } catch (err) {
      await queryRunner.rollbackTransaction();
      this.logger.error(
        `Scan application ROLLED BACK for store ${storeId}: ${err}`,
      );
      throw err;
    } finally {
      await queryRunner.release();
    }

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
