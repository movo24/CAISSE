import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { AirtableOpsConfig } from '../airtable-ops.config';
import { AirtableOpsSyncService } from '../airtable-ops.sync.service';

/**
 * Scheduled cron jobs for the Airtable Ops module.
 *
 * Jobs run every 30 minutes by default (AIRTABLE_SYNC_CRON env var is
 * documented for reference — NestJS @Cron decorators must be static at
 * compile time so we use the hardcoded expression here).
 *
 * All jobs are no-ops when AIRTABLE_ENABLED != 'true'.
 */
@Injectable()
export class AirtableSyncJob {
  private readonly logger = new Logger(AirtableSyncJob.name);

  constructor(
    private readonly config: AirtableOpsConfig,
    private readonly syncService: AirtableOpsSyncService,
  ) {}

  /**
   * Export POS products → Airtable every 30 minutes.
   * Only exports products updated since the previous successful export.
   */
  @Cron('*/30 * * * *', { name: 'airtable-export-products', timeZone: 'Europe/Paris' })
  async exportProducts(): Promise<void> {
    if (!this.config.enabled) return;

    this.logger.log('airtable-export-products: starting incremental export');
    const start = Date.now();

    try {
      await this.syncService.exportProducts(undefined, false, 'CRON');
      this.logger.log(
        `airtable-export-products: done in ${Date.now() - start}ms`,
      );
    } catch (err: any) {
      this.logger.error(
        `airtable-export-products: failed — ${err?.message ?? err}`,
      );
    }
  }

  /**
   * Import Airtable suggestions → pending operations every 30 minutes.
   * Offset by 15 minutes relative to export (runs at :15 and :45).
   */
  @Cron('15,45 * * * *', { name: 'airtable-import-suggestions', timeZone: 'Europe/Paris' })
  async importSuggestions(): Promise<void> {
    if (!this.config.enabled) return;

    this.logger.log('airtable-import-suggestions: starting import');
    const start = Date.now();

    try {
      await this.syncService.importProductSuggestions(undefined, 'CRON');
      this.logger.log(
        `airtable-import-suggestions: done in ${Date.now() - start}ms`,
      );
    } catch (err: any) {
      this.logger.error(
        `airtable-import-suggestions: failed — ${err?.message ?? err}`,
      );
    }
  }
}
