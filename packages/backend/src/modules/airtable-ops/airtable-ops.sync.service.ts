import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, MoreThan } from 'typeorm';
import axios, { AxiosInstance } from 'axios';

import { ProductEntity } from '../../database/entities/product.entity';
import { AirtableLinkedRecordEntity } from '../../database/entities/airtable-linked-record.entity';
import { AirtableSyncLogEntity } from '../../database/entities/airtable-sync-log.entity';
import {
  AirtableOperationEntity,
} from '../../database/entities/airtable-operation.entity';
import { AirtableOpsConfig } from './airtable-ops.config';
import {
  AirtableOpsMapper,
  AirtableProductImportFields,
  AT_FIELD,
} from './airtable-ops.mapper';
import { SyncTrigger } from '../../database/entities/airtable-sync-log.entity';

interface AirtableRecord {
  id: string;
  fields: Record<string, unknown>;
  createdTime: string;
}

interface AirtableListResponse {
  records: AirtableRecord[];
  offset?: string;
}

@Injectable()
export class AirtableOpsSyncService {
  private readonly logger = new Logger(AirtableOpsSyncService.name);
  private readonly http: AxiosInstance;

  constructor(
    @InjectRepository(ProductEntity)
    private readonly productRepo: Repository<ProductEntity>,
    @InjectRepository(AirtableLinkedRecordEntity)
    private readonly linkedRepo: Repository<AirtableLinkedRecordEntity>,
    @InjectRepository(AirtableSyncLogEntity)
    private readonly syncLogRepo: Repository<AirtableSyncLogEntity>,
    @InjectRepository(AirtableOperationEntity)
    private readonly operationRepo: Repository<AirtableOperationEntity>,
    private readonly config: AirtableOpsConfig,
    private readonly mapper: AirtableOpsMapper,
  ) {
    this.http = axios.create({
      baseURL: 'https://api.airtable.com/v0',
      timeout: 10_000,
      headers: {
        Authorization: `Bearer ${this.config.apiKey}`,
        'Content-Type': 'application/json',
      },
    });
  }

  // ── Rate-limit helpers ────────────────────────────────────────────────────

  /** Waits at least `config.minDelayMs` between calls */
  private async rateLimitDelay(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, this.config.minDelayMs));
  }

  // ── Public API ────────────────────────────────────────────────────────────

  /**
   * Export POS products → Airtable.
   *
   * For each product: upsert the Airtable record (create or update).
   * Maintains the AirtableLinkedRecord mapping table.
   *
   * @param storeId   When provided, only syncs products from that store.
   * @param forceAll  When true, ignores lastSyncedAt and exports everything.
   * @param trigger   How this sync was initiated (CRON, MANUAL, WEBHOOK).
   */
  async exportProducts(
    storeId: string | undefined,
    forceAll: boolean,
    trigger: SyncTrigger,
  ): Promise<void> {
    if (!this.config.enabled) return;

    const startedAt = Date.now();
    let processed = 0;
    let failed = 0;

    try {
      const products = await this.findProductsForExport(storeId, forceAll);
      this.logger.log(`export-products: ${products.length} product(s) to sync`);

      for (const product of products) {
        try {
          await this.upsertProductToAirtable(product);
          processed++;
        } catch (err: any) {
          failed++;
          this.logger.warn(
            `export-products: failed for product ${product.id}: ${err?.message}`,
          );
        }
        await this.rateLimitDelay();
      }

      await this.writeSyncLog({
        direction: 'EXPORT',
        entityType: 'product',
        airtableTableId: this.config.productsTableId,
        storeId: storeId ?? null,
        recordsProcessed: processed,
        recordsFailed: failed,
        durationMs: Date.now() - startedAt,
        status: failed === 0 ? 'SUCCESS' : processed === 0 ? 'FAILED' : 'PARTIAL',
        errorMessage: null,
        triggeredBy: trigger,
      });
    } catch (err: any) {
      const msg = err?.message ?? String(err);
      this.logger.error(`export-products: fatal error — ${msg}`);
      await this.writeSyncLog({
        direction: 'EXPORT',
        entityType: 'product',
        airtableTableId: this.config.productsTableId,
        storeId: storeId ?? null,
        recordsProcessed: processed,
        recordsFailed: failed,
        durationMs: Date.now() - startedAt,
        status: 'FAILED',
        errorMessage: msg,
        triggeredBy: trigger,
      });
    }
  }

  /**
   * Import Airtable product suggestions → pending AirtableOperation rows.
   *
   * Reads the Airtable table, compares with POS, creates AirtableOperation
   * rows for every field that differs. Never modifies POS data directly.
   */
  async importProductSuggestions(
    storeId: string | undefined,
    trigger: SyncTrigger,
  ): Promise<void> {
    if (!this.config.enabled) return;

    const startedAt = Date.now();
    let processed = 0;
    let failed = 0;

    try {
      const allRecords = await this.fetchAllAirtableRecords(
        this.config.productsTableId,
      );
      this.logger.log(`import-products: ${allRecords.length} record(s) from Airtable`);

      for (const record of allRecords) {
        try {
          await this.processImportRecord(record, storeId);
          processed++;
        } catch (err: any) {
          failed++;
          this.logger.warn(
            `import-products: failed for record ${record.id}: ${err?.message}`,
          );
        }
        await this.rateLimitDelay();
      }

      await this.writeSyncLog({
        direction: 'IMPORT',
        entityType: 'product',
        airtableTableId: this.config.productsTableId,
        storeId: storeId ?? null,
        recordsProcessed: processed,
        recordsFailed: failed,
        durationMs: Date.now() - startedAt,
        status: failed === 0 ? 'SUCCESS' : processed === 0 ? 'FAILED' : 'PARTIAL',
        errorMessage: null,
        triggeredBy: trigger,
      });
    } catch (err: any) {
      const msg = err?.message ?? String(err);
      this.logger.error(`import-products: fatal error — ${msg}`);
      await this.writeSyncLog({
        direction: 'IMPORT',
        entityType: 'product',
        airtableTableId: this.config.productsTableId,
        storeId: storeId ?? null,
        recordsProcessed: processed,
        recordsFailed: failed,
        durationMs: Date.now() - startedAt,
        status: 'FAILED',
        errorMessage: msg,
        triggeredBy: trigger,
      });
    }
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  private async findProductsForExport(
    storeId: string | undefined,
    forceAll: boolean,
  ): Promise<ProductEntity[]> {
    const where: Record<string, unknown> = { isActive: true };
    if (storeId) where['storeId'] = storeId;

    if (!forceAll) {
      // Only products updated since our last sync (or never synced)
      const lastSync = await this.syncLogRepo.findOne({
        where: {
          direction: 'EXPORT',
          entityType: 'product',
          ...(storeId ? { storeId } : {}),
          status: 'SUCCESS',
        },
        order: { createdAt: 'DESC' },
      });

      if (lastSync) {
        where['updatedAt'] = MoreThan(lastSync.createdAt);
      }
    }

    return this.productRepo.find({ where });
  }

  private async upsertProductToAirtable(product: ProductEntity): Promise<void> {
    const fields = this.mapper.productToAirtable(product);

    const existing = await this.linkedRepo.findOne({
      where: {
        localEntityType: 'product',
        localEntityId: product.id,
        airtableTableId: this.config.productsTableId,
      },
    });

    if (existing) {
      // Update existing Airtable record
      await this.http.patch(
        `/${this.config.baseId}/${this.config.productsTableId}/${existing.airtableRecordId}`,
        { fields },
      );
      await this.linkedRepo.update(existing.id, { lastSyncedAt: new Date() });
    } else {
      // Create new Airtable record
      const res = await this.http.post<{ id: string }>(
        `/${this.config.baseId}/${this.config.productsTableId}`,
        { fields },
      );
      const airtableRecordId = res.data.id;

      const linked = this.linkedRepo.create({
        localEntityType: 'product',
        localEntityId: product.id,
        airtableTableId: this.config.productsTableId,
        airtableRecordId,
        storeId: product.storeId,
        lastSyncedAt: new Date(),
      });
      await this.linkedRepo.save(linked);
    }
  }

  private async fetchAllAirtableRecords(tableId: string): Promise<AirtableRecord[]> {
    const records: AirtableRecord[] = [];
    let offset: string | undefined;

    do {
      await this.rateLimitDelay();
      const params: Record<string, string> = {};
      if (offset) params['offset'] = offset;

      const res = await this.http.get<AirtableListResponse>(
        `/${this.config.baseId}/${tableId}`,
        { params },
      );

      records.push(...res.data.records);
      offset = res.data.offset;
    } while (offset);

    return records;
  }

  private async processImportRecord(
    record: AirtableRecord,
    filterStoreId: string | undefined,
  ): Promise<void> {
    const posId = record.fields[AT_FIELD.POS_ID] as string | undefined;
    if (!posId) return; // Record has no linked POS product — skip

    const product = await this.productRepo.findOne({ where: { id: posId } });
    if (!product) return;

    // Respect storeId filter
    if (filterStoreId && product.storeId !== filterStoreId) return;

    const importFields = record.fields as AirtableProductImportFields;
    const proposedOps = this.mapper.airtableToProductOperations(importFields, product);

    for (const op of proposedOps) {
      // Dedup: skip if a pending operation for the same product+field already exists
      const exists = await this.operationRepo.findOne({
        where: {
          entityType: 'product',
          entityId: product.id,
          field: op.field,
          status: 'pending',
        },
      });
      if (exists) continue;

      const operation = this.operationRepo.create({
        entityType: 'product',
        entityId: product.id,
        storeId: product.storeId,
        field: op.field,
        currentValue: op.currentValue,
        proposedValue: op.proposedValue,
        riskLevel: op.riskLevel,
        status: 'pending',
        sourceAirtableRecordId: record.id,
        sourceAirtableTableId: this.config.productsTableId,
      });
      await this.operationRepo.save(operation);
    }
  }

  private async writeSyncLog(
    data: Omit<AirtableSyncLogEntity, 'id' | 'createdAt'>,
  ): Promise<void> {
    try {
      const log = this.syncLogRepo.create(data);
      await this.syncLogRepo.save(log);
    } catch (err: any) {
      // Log writing must never crash the sync itself
      this.logger.error(`Failed to write sync log: ${err?.message}`);
    }
  }
}
