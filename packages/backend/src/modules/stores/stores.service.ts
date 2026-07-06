import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { StoreEntity } from '../../database/entities/store.entity';
import { OrganizationEntity } from '../../database/entities/organization.entity';
import { UnitEntity } from '../../database/entities/unit.entity';
import { BusinessError } from '../../common/errors/business-error';
import { CreateStoreDto, MODES_REQUIRING_COMPANY } from '../../common/dto';
import { reconcileLegalIds } from '../../common/legal/legal-id.util';
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

    // ── 5. Validate legal identity + operating-mode rules (may mutate dto: auto-fill SIREN) ──
    this.validateStoreIdentity(dto);

    const store = this.storeRepo.create(dto);
    const saved = await this.storeRepo.save(store);
    this.logger.log(
      `Store created: ${saved.name} [${saved.storeCode}] (${saved.id})`,
    );

    // Sync to TimeWin24 — POS Caisse is source of truth for stores
    this.syncStoreToTimewin(saved, 'store.created').catch((err) =>
      this.logger.warn(`[TW24] Store sync failed for ${saved.name}: ${err?.message}`),
    );

    return saved;
  }

  /**
   * Validate the store's legal identity + operating-mode rules. Mutates the dto
   * in place to auto-fill the SIREN from the SIRET when appropriate. Throws
   * BadRequestException with a clear, aggregated message on any hard error.
   * Applies to both create and update payloads.
   */
  private validateStoreIdentity(dto: {
    siren?: string | null;
    siret?: string | null;
    tvaIntracom?: string | null;
    country?: string | null;
    operatingMode?: string | null;
    operatingCompanyName?: string | null;
  }): void {
    // Operating mode → operating company requirement (franchise/affilié/licence/partenaire).
    if (
      dto.operatingMode &&
      (MODES_REQUIRING_COMPANY as readonly string[]).includes(dto.operatingMode) &&
      !(dto.operatingCompanyName && dto.operatingCompanyName.trim())
    ) {
      throw new BadRequestException(
        `Le mode d'exploitation « ${dto.operatingMode} » exige une société exploitante (nom de la société).`,
      );
    }

    // SIREN / SIRET coherence (only when at least one is provided).
    if (dto.siren || dto.siret) {
      const isFrench = !dto.country || dto.country.trim().toLowerCase() === 'france';
      const res = reconcileLegalIds({
        siren: dto.siren,
        siret: dto.siret,
        vatNumber: dto.tvaIntracom,
        isFrench,
      });
      if (res.errors.length > 0) {
        throw new BadRequestException(res.errors.join(' '));
      }
      // Persist normalised / auto-filled values.
      if (res.siren) dto.siren = res.siren;
      if (res.siret) dto.siret = res.siret;
    }
  }

  /**
   * Push a store to TimeWin24 after creation/update.
   * POS Caisse = source of truth for stores.
   * TimeWin24 creates a local copy to link employees/shifts.
   */
  private async syncStoreToTimewin(
    store: StoreEntity,
    eventType: 'store.created' | 'store.updated' = 'store.created',
  ): Promise<void> {
    try {
      await this.timewinService.pushEvent(store.id, eventType, undefined, {
        id: store.id,
        name: store.name,
        storeCode: store.storeCode,
        city: store.city,
        address: store.address,
        active: store.isActive && !store.isArchived,
      });
      this.logger.log(`[TW24] Store synced (${eventType}): ${store.name} (${store.id})`);
    } catch (err: any) {
      this.logger.warn(`[TW24] Store sync failed: ${err?.message}`);
    }
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
    // Legal-identity + operating-mode validation on the patch (auto-fills SIREN).
    this.validateStoreIdentity(data);
    await this.storeRepo.update(id, data);
    const updated = await this.findOne(id);
    this.syncStoreToTimewin(updated, 'store.updated').catch((err) =>
      this.logger.warn(`[TW24] Store update sync failed: ${err?.message}`),
    );
    return updated;
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
    this.syncStoreToTimewin(saved, 'store.updated').catch((err) =>
      this.logger.warn(`[TW24] Store archive sync failed: ${err?.message}`),
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
    this.syncStoreToTimewin(saved, 'store.updated').catch((err) =>
      this.logger.warn(`[TW24] Store reactivate sync failed: ${err?.message}`),
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
    this.syncStoreToTimewin(saved, 'store.updated').catch((err) =>
      this.logger.warn(`[TW24] Store deactivate sync failed: ${err?.message}`),
    );
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
    this.syncStoreToTimewin(saved, 'store.updated').catch((err) =>
      this.logger.warn(`[TW24] Store activate sync failed: ${err?.message}`),
    );
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

  // ── Operating Hours (proxied to TimeWin24) ──

  async getStoreSchedule(storeId: string): Promise<any> {
    try {
      return await this.timewinService.getStoreSchedule(storeId);
    } catch (err: any) {
      this.logger.warn(`[Schedule] Failed to fetch from TimeWin24: ${err?.message}`);
      return []; // Return empty if TimeWin24 is down
    }
  }

  async updateStoreSchedule(storeId: string, schedules: any[]): Promise<any> {
    try {
      return await this.timewinService.updateStoreSchedule(storeId, schedules);
    } catch (err: any) {
      this.logger.warn(`[Schedule] Failed to save to TimeWin24: ${err?.message}`);
      throw new Error('TimeWin24 indisponible — impossible de sauvegarder les horaires. Réessayez plus tard.');
    }
  }

  /**
   * Get consolidated network summary across all stores with includeInNetwork=true.
   */
  async getNetworkSummary() {
    const stores = await this.storeRepo.find({
      where: { isActive: true },
      order: { name: 'ASC' },
    });

    const includedStores = stores.filter((s) => s.includeInNetwork);
    const excludedStores = stores.filter((s) => !s.includeInNetwork);

    // Get sales data for ALL included stores in a SINGLE aggregated query
    // (previously 2 queries per store → 2N). All-time + today via FILTER.
    const includedIds = includedStores.map((s) => s.id);
    const aggRows = includedIds.length
      ? await this.dataSource.query(
          `SELECT
             store_id,
             COUNT(*) AS sale_count,
             COALESCE(SUM(total_minor_units), 0) AS total_revenue,
             COALESCE(AVG(total_minor_units), 0) AS avg_ticket,
             COUNT(*) FILTER (WHERE created_at >= CURRENT_DATE) AS today_count,
             COALESCE(SUM(total_minor_units) FILTER (WHERE created_at >= CURRENT_DATE), 0) AS today_revenue
           FROM sales
           WHERE status = 'completed' AND store_id = ANY($1)
           GROUP BY store_id`,
          [includedIds],
        )
      : [];
    const statsByStore = new Map<string, any>(aggRows.map((r: any) => [r.store_id, r]));

    const storeStats = includedStores.map((store) => {
      const r = statsByStore.get(store.id);
      return {
        id: store.id,
        name: store.name,
        storeCode: store.storeCode,
        city: store.city,
        includeInNetwork: store.includeInNetwork,
        totalSales: parseInt(r?.sale_count || '0'),
        totalRevenue: parseInt(r?.total_revenue || '0'),
        avgTicket: Math.round(parseFloat(r?.avg_ticket || '0')),
        todaySales: parseInt(r?.today_count || '0'),
        todayRevenue: parseInt(r?.today_revenue || '0'),
      };
    });

    // Network totals
    const networkTotalRevenue = storeStats.reduce((s, st) => s + st.totalRevenue, 0);
    const networkTotalSales = storeStats.reduce((s, st) => s + st.totalSales, 0);
    const networkAvgTicket = networkTotalSales > 0 ? Math.round(networkTotalRevenue / networkTotalSales) : 0;
    const networkTodayRevenue = storeStats.reduce((s, st) => s + st.todayRevenue, 0);
    const networkTodaySales = storeStats.reduce((s, st) => s + st.todaySales, 0);

    // Rankings
    const sortedByRevenue = [...storeStats].sort((a, b) => b.totalRevenue - a.totalRevenue);

    return {
      network: {
        storeCount: includedStores.length,
        excludedCount: excludedStores.length,
        totalRevenue: networkTotalRevenue,
        totalSales: networkTotalSales,
        avgTicket: networkAvgTicket,
        todayRevenue: networkTodayRevenue,
        todaySales: networkTodaySales,
      },
      stores: storeStats,
      ranking: sortedByRevenue.map((s, i) => ({
        rank: i + 1,
        storeId: s.id,
        name: s.name,
        totalRevenue: s.totalRevenue,
        todayRevenue: s.todayRevenue,
      })),
      excludedStores: excludedStores.map((s) => ({
        id: s.id,
        name: s.name,
        storeCode: s.storeCode,
      })),
    };
  }
}
