import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, MoreThan, Repository } from 'typeorm';
import { IntegrationEventEntity } from '../../database/entities/integration-event.entity';
import { normalizeEventsQuery } from './events-query';

export interface ConsumerEvent {
  id: string;
  type: string;
  aggregateType: string;
  aggregateId: string;
  storeId: string;
  organizationId: string | null;
  occurredAt: string;
  payload: Record<string, unknown>;
  schemaVersion: number;
}

/**
 * Read-only consumer view of the integration outbox (Analytik R & co.).
 * Incremental polling by `occurredAt` cursor, tenant-scoped. Never mutates
 * anything; safe to call repeatedly. Consumers track the last `occurredAt`.
 */
@Injectable()
export class OutboxQueryService {
  constructor(
    @InjectRepository(IntegrationEventEntity)
    private readonly events: Repository<IntegrationEventEntity>,
  ) {}

  async listForConsumer(
    storeId: string,
    query: { since?: string; limit?: string | number; type?: string },
  ): Promise<{ events: ConsumerEvent[]; nextCursor: string | null }> {
    const q = normalizeEventsQuery(query);
    const where: any = { storeId };
    if (q.sinceDate) where.occurredAt = MoreThan(q.sinceDate);
    if (q.types.length) where.type = In(q.types);

    const rows = await this.events.find({
      where,
      order: { occurredAt: 'ASC', id: 'ASC' },
      take: q.limit,
    });

    const events: ConsumerEvent[] = rows.map((r) => ({
      id: r.id,
      type: r.type,
      aggregateType: r.aggregateType,
      aggregateId: r.aggregateId,
      storeId: r.storeId,
      organizationId: r.organizationId,
      occurredAt: r.occurredAt.toISOString(),
      payload: r.payload,
      schemaVersion: r.schemaVersion,
    }));

    const nextCursor = events.length ? events[events.length - 1].occurredAt : null;
    return { events, nextCursor };
  }
}
