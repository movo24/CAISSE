import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { randomUUID } from 'crypto';
import { IntegrationEventEntity } from '../../database/entities/integration-event.entity';
import { isEligibleForRelay, relayOutcome } from '../../common/integration/outbox-relay';
import { OUTBOX_PUBLISHER, OutboxPublisher } from './outbox-publisher';

export interface RelayReport {
  /** Correlation id of this relay run — sent as `x-pos-batch-id` on every delivery. */
  batchId: string;
  processed: number;
  published: number;
  pending: number;
  failed: number;
}

/**
 * Outbox relay — publishes pending/retryable events out-of-band (cron or admin
 * trigger). NEVER in the caisse path. Only delivery metadata is mutated; business
 * fields stay immutable. Uses the injected publisher (simulation in sandbox).
 */
@Injectable()
export class OutboxRelayService {
  private readonly logger = new Logger(OutboxRelayService.name);

  constructor(
    @InjectRepository(IntegrationEventEntity)
    private readonly events: Repository<IntegrationEventEntity>,
    @Inject(OUTBOX_PUBLISHER) private readonly publisher: OutboxPublisher,
  ) {}

  /** Relay a batch of eligible events. `storeId` optional → all stores. */
  async relayBatch(limit = 100, storeId?: string): Promise<RelayReport> {
    const where: any = { status: In(['pending', 'failed']) };
    if (storeId) where.storeId = storeId;
    const candidates = await this.events.find({
      where,
      order: { createdAt: 'ASC' },
      take: limit,
    });

    const batchId = randomUUID(); // correlation only — idempotence stays per-event id
    const report: RelayReport = { batchId, processed: 0, published: 0, pending: 0, failed: 0 };
    for (const row of candidates) {
      if (!isEligibleForRelay(row.status, row.attempts)) continue;
      report.processed++;
      let success = false;
      try {
        success = await this.publisher.publish(row, batchId);
      } catch (e: any) {
        this.logger.warn(`Publish failed for ${row.id}: ${e?.message}`);
        success = false;
      }
      const outcome = relayOutcome(success, row.attempts);
      await this.events.update(row.id, {
        status: outcome.status,
        attempts: outcome.attempts,
        publishedAt: outcome.publishedAt,
      });
      report[outcome.status === 'published' ? 'published' : outcome.status]++;
    }
    return report;
  }
}
