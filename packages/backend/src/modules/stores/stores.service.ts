import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { StoreEntity } from '../../database/entities/store.entity';
import { OrganizationEntity } from '../../database/entities/organization.entity';
import { UnitEntity } from '../../database/entities/unit.entity';
import { BusinessError } from '../../common/errors/business-error';
import { CreateStoreDto } from '../../common/dto';
import { mapStoreEntityToStoreInfo } from './store-info.mapper';
import { generateUniqueStoreCode } from '../../common/utils/store-code-generator';
import { TimewinService } from '../timewin/timewin.service';

@Injectable()
export class StoresService {
  private readonly logger = new Logger(StoresService.name);

  constructor(
    @InjectRepository(StoreEntity)
    private storeRepo: Repository<StoreEntity>,
    @InjectRepository(OrganizationEntity)
    private orgRepo: Repository<OrganizationEntity>,
    @InjectRepository(UnitEntity)
    private unitRepo: Repository<UnitEntity>,
    private dataSource: DataSource,
    private timewinService: TimewinService,
  ) {}

  async create(dto: CreateStoreDto): Promise<StoreEntity> {
    // ── 1. Auto-generate store_code if not provided ──
    if (!dto.storeCode) {
      dto.storeCode = await generateUniqueStoreCode(
        dto.name,
        dto.city,
        async (code) => {
          const found = await this.storeRepo.findOne({
            where: { storeCode: code },
          });
          return !!found;
        },
      );
      this.logger.log(`Auto-generated store code: ${dto.storeCode}`);
    } else {
      // ── 2. Validate storeCode uniqueness if manually provided ──
      const existing = await this.storeRepo.findOne({
        where: { storeCode: dto.storeCode },
      });
      if (existing) {
        throw BusinessError.alreadyExists('Store', 'storeCode', dto.storeCode);
      }
    }

    // ── 3. Validate organization exists if provided ──
    if (dto.organizationId) {
      const org = await this.orgRepo.findOne({
        where: { id: dto.organizationId },
      });
      if (!org) {
        throw BusinessError.invalidRelation(
          `Organization avec l'identifiant « ${dto.organizationId} » est introuvable.`,
        );
      }
    }

    // ── 4. Validate unit exists and belongs to same org if provided ──
    if (dto.unitId) {
      const unit = await this.unitRepo.findOne({
        where: { id: dto.unitId },
      });
      if (!unit) {
        throw BusinessError.invalidRelation(
          `Unit avec l'identifiant « ${dto.unitId} » est introuvable.`,
        );
      }
      if (
        dto.organizationId &&
        unit.organizationId !== dto.organizationId
      ) {
        throw BusinessError.invalidRelation(
          `Unit « ${unit.name} » n'appartient pas à l'organisation spécifiée.`,
        );
      }
    }

    const store = this.storeRepo.create(dto);
    const saved = await this.storeRepo.save(store);
    this.logger.log(
      `Store created: ${saved.name} [${saved.storeCode}] (${saved.id})`,
    );
    return saved;
  }

  /** List all stores, optionally filtered by organization or unit */
  async findAll(filters?: {
    organizationId?: string;
    unitId?: string;
  }): Promise<StoreEntity[]> {
    const where: any = {};
    if (filters?.organizationId)
      where.organizationId = filters.organizationId;
    if (filters?.unitId) where.unitId = filters.unitId;
    return this.storeRepo.find({
      where,
      order: { name: 'ASC' },
      relations: ['organization', 'unit'],
    });
  }

  /** Returns only the user's own store (tenant-scoped) */
  async findMyStore(storeId: string): Promise<StoreEntity> {
    const store = await this.storeRepo.findOne({
      where: { id: storeId, isActive: true },
    });
    if (!store) throw BusinessError.notFound('Store', storeId);
    return store;
  }

  async findOne(id: string): Promise<StoreEntity> {
    const store = await this.storeRepo.findOne({ where: { id } });
    if (!store) throw BusinessError.notFound('Store', id);
    return store;
  }

  /** Returns store info formatted for POS frontend (StoreInfo shape) */
  async getStoreInfo(storeId: string) {
    const store = await this.findMyStore(storeId);
    return mapStoreEntityToStoreInfo(store);
  }

  async update(
    id: string,
    data: Partial<StoreEntity>,
    callerStoreId: string,
  ): Promise<StoreEntity> {
    // Only allow updating your own store
    if (id !== callerStoreId) {
      throw BusinessError.forbidden(
        'Access denied: you cannot modify another store.',
      );
    }
    await this.findOne(id);
    await this.storeRepo.update(id, data);
    return this.findOne(id);
  }

  // ─── Archive (soft-delete) ──────────────────────────────────────
  async archive(id: string, adminId: string): Promise<StoreEntity> {
    const store = await this.findOne(id);
    store.isArchived = true;
    store.isActive = false;
    const saved = await this.storeRepo.save(store);
    this.logger.warn(
      `[STORE:ARCHIVE] Store "${saved.name}" (${saved.id}) archived by admin ${adminId} at ${new Date().toISOString()}`,
    );
    return saved;
  }

  // ─── Reactivate ────────────────────────────────────────────────
  async reactivate(id: string, adminId: string): Promise<StoreEntity> {
    const store = await this.findOne(id);
    if (!store.isArchived) {
      throw BusinessError.forbidden('Ce magasin n\'est pas archivé.');
    }
    store.isArchived = false;
    store.isActive = true;
    const saved = await this.storeRepo.save(store);
    this.logger.warn(
      `[STORE:REACTIVATE] Store "${saved.name}" (${saved.id}) reactivated by admin ${adminId} at ${new Date().toISOString()}`,
    );
    return saved;
  }

  // ─── Hard delete (irreversible) ────────────────────────────────
  async hardDelete(id: string, adminId: string): Promise<{ message: string }> {
    const store = await this.findOne(id);
    const storeName = store.name;

    // All related tables with store_id column — delete in dependency order
    // Only tables that actually have a store_id column (verified against DB)
    // Order: children before parents to avoid FK violations
    const tablesWithStoreId = [
      'inventory_scans',
      'audit_entries',
      'z_reports',
      'pointage_entries',
      'staffing_snapshots',
      'payroll_configs',
      'jackpot_wins',
      'jackpot_configs',
      'promo_rules',
      'product_categories',
      'subscriptions',
      'store_contexts',
    ];
    // sale_line_items + sale_payments reference sales (not store_id)
    const salesChildren = ['sale_line_items', 'sale_payments'];
    // These have store_id AND are referenced by other tables
    const coreTablesWithStoreId = ['sales', 'products', 'customers', 'employees'];

    const qr = this.dataSource.createQueryRunner();
    await qr.connect();
    await qr.startTransaction();

    try {
      // 1. Delete sale children (they reference sales, not store_id)
      for (const table of salesChildren) {
        await qr.query(
          `DELETE FROM ${table} WHERE sale_id IN (SELECT id FROM sales WHERE store_id = $1)`,
          [id],
        );
      }
      // 2. Delete tables with store_id (no ordering issues)
      for (const table of tablesWithStoreId) {
        await qr.query(`DELETE FROM ${table} WHERE store_id = $1`, [id]);
      }
      // 3. Delete core tables (sales, products, customers, employees)
      for (const table of coreTablesWithStoreId) {
        await qr.query(`DELETE FROM ${table} WHERE store_id = $1`, [id]);
      }
      // Finally delete the store itself
      await qr.query(`DELETE FROM stores WHERE id = $1`, [id]);
      await qr.commitTransaction();
    } catch (err) {
      await qr.rollbackTransaction();
      this.logger.error(`[STORE:HARD_DELETE] Failed for store ${id}: ${err}`);
      throw err;
    } finally {
      await qr.release();
    }

    this.logger.warn(
      `[STORE:HARD_DELETE] Store "${storeName}" (${id}) permanently deleted by admin ${adminId} at ${new Date().toISOString()}. All related data destroyed.`,
    );
    return { message: `Magasin "${storeName}" et toutes ses données ont été supprimés définitivement.` };
  }

  async deactivate(id: string): Promise<StoreEntity> {
    const store = await this.findOne(id);
    store.isActive = false;
    const saved = await this.storeRepo.save(store);
    this.logger.log(`Store deactivated: ${saved.name} (${saved.id})`);
    return saved;
  }

  async activate(id: string): Promise<StoreEntity> {
    const store = await this.findOne(id);
    if (store.isArchived) {
      throw BusinessError.archived('Store');
    }
    store.isActive = true;
    const saved = await this.storeRepo.save(store);
    this.logger.log(`Store activated: ${saved.name} (${saved.id})`);
    return saved;
  }

  /** Sync stores from TimeWin24 (source of truth) → POS local DB */
  async syncFromTimeWin(): Promise<{ created: number; updated: number; total: number }> {
    const twStores = await this.timewinService.fetchStores();
    let created = 0;
    let updated = 0;

    for (const tw of twStores) {
      const existing = await this.storeRepo.findOne({ where: { id: tw.id } });

      if (existing) {
        // Update name, storeCode, city, status from TimeWin24
        existing.name = tw.name;
        existing.storeCode = tw.storeCode || existing.storeCode;
        existing.city = tw.city || existing.city;
        existing.currencyCode = tw.currency || existing.currencyCode;
        existing.timezone = tw.timezone || existing.timezone;
        existing.isActive = tw.status === 'ACTIVE';
        existing.latitude = tw.latitude ?? existing.latitude;
        existing.longitude = tw.longitude ?? existing.longitude;
        await this.storeRepo.save(existing);
        updated++;
      } else {
        // Create new store with TimeWin24 UUID
        const store = this.storeRepo.create({
          id: tw.id,
          name: tw.name,
          storeCode: tw.storeCode || undefined,
          city: tw.city || undefined,
          address: tw.address || undefined,
          currencyCode: tw.currency || 'EUR',
          timezone: tw.timezone || 'Europe/Paris',
          isActive: tw.status === 'ACTIVE',
          latitude: tw.latitude,
          longitude: tw.longitude,
        });
        await this.storeRepo.save(store);
        created++;
      }
    }

    // Deactivate POS stores not present in TimeWin24
    const twIds = twStores.map((s: any) => s.id);
    const allLocal = await this.storeRepo.find({ where: { isActive: true } });
    for (const local of allLocal) {
      if (!twIds.includes(local.id)) {
        local.isActive = false;
        await this.storeRepo.save(local);
        this.logger.warn(`[SYNC] Deactivated store "${local.name}" (${local.id}) — not in TimeWin24`);
      }
    }

    this.logger.log(`[SYNC] TimeWin24 → POS: ${created} created, ${updated} updated, ${twStores.length} total`);
    return { created, updated, total: twStores.length };
  }
}
