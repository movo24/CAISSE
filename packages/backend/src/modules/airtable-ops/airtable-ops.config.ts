import { Injectable, Logger } from '@nestjs/common';

/**
 * Injectable config wrapper for the Airtable Ops module.
 * All values are read from env at boot — never hardcoded.
 *
 * When AIRTABLE_ENABLED=false (default) the entire module is a no-op:
 * no HTTP calls are made and cron jobs exit immediately.
 */
@Injectable()
export class AirtableOpsConfig {
  private readonly logger = new Logger(AirtableOpsConfig.name);

  readonly enabled: boolean;
  readonly apiKey: string;
  readonly baseId: string;
  readonly productsTableId: string;
  readonly storesTableId: string;
  readonly suppliersTableId: string;
  readonly stockTableId: string;
  readonly operationsTableId: string;
  readonly webhookSecret: string;
  readonly syncCron: string;
  readonly rateLimitPerSecond: number;

  constructor() {
    this.enabled = process.env.AIRTABLE_ENABLED === 'true';
    this.apiKey = process.env.AIRTABLE_API_KEY ?? '';
    this.baseId = process.env.AIRTABLE_BASE_ID ?? '';
    this.productsTableId = process.env.AIRTABLE_PRODUCTS_TABLE_ID ?? '';
    this.storesTableId = process.env.AIRTABLE_STORES_TABLE_ID ?? '';
    this.suppliersTableId = process.env.AIRTABLE_SUPPLIERS_TABLE_ID ?? '';
    this.stockTableId = process.env.AIRTABLE_STOCK_TABLE_ID ?? '';
    this.operationsTableId = process.env.AIRTABLE_OPERATIONS_TABLE_ID ?? '';
    this.webhookSecret = process.env.AIRTABLE_WEBHOOK_SECRET ?? '';
    this.syncCron = process.env.AIRTABLE_SYNC_CRON ?? '*/30 * * * *';
    this.rateLimitPerSecond = parseInt(
      process.env.AIRTABLE_RATE_LIMIT_PER_SECOND ?? '4',
      10,
    );

    if (this.enabled) {
      this.validateOrThrow();
    } else {
      this.logger.log('Airtable Ops module is DISABLED (AIRTABLE_ENABLED != true)');
    }
  }

  private validateOrThrow(): void {
    const missing: string[] = [];
    if (!this.apiKey) missing.push('AIRTABLE_API_KEY');
    if (!this.baseId) missing.push('AIRTABLE_BASE_ID');
    if (!this.productsTableId) missing.push('AIRTABLE_PRODUCTS_TABLE_ID');
    if (!this.webhookSecret) missing.push('AIRTABLE_WEBHOOK_SECRET');

    if (missing.length > 0) {
      throw new Error(
        `AirtableOps: missing required env vars when AIRTABLE_ENABLED=true: ${missing.join(', ')}`,
      );
    }

    if (this.rateLimitPerSecond < 1 || this.rateLimitPerSecond > 10) {
      throw new Error(
        `AIRTABLE_RATE_LIMIT_PER_SECOND must be between 1 and 10 (got ${this.rateLimitPerSecond})`,
      );
    }
  }

  /** Minimum delay in ms between consecutive Airtable API calls */
  get minDelayMs(): number {
    return Math.ceil(1000 / this.rateLimitPerSecond);
  }
}
