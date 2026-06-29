import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, Brackets, In, Repository } from 'typeorm';
import { IntegrationEventEntity } from '../../database/entities/integration-event.entity';
import { normalizeEventsQuery, encodeEventsCursor } from './events-query';
import { shapeOutboxStats, OutboxStats } from './outbox-stats';
import { dayRangeUtc } from '../comptamax/journal-range';
import { summarizeShifts, toShiftEvents, shiftsToCsv, ShiftSummary } from '../timewin/shift-amplitude';

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

    // POS-INT-103 — keyset pagination on (occurredAt, id). A composite cursor
    // (sinceId present) resumes strictly after the last event even when several
    // events share the same occurredAt; a bare-timestamp cursor keeps the legacy
    // strict-after-timestamp behaviour.
    const qb = this.events
      .createQueryBuilder('e')
      .where('e.store_id = :storeId', { storeId });
    if (q.types.length) qb.andWhere('e.type IN (:...types)', { types: q.types });
    if (q.sinceDate && q.sinceId) {
      qb.andWhere(
        new Brackets((b) => {
          b.where('e.occurred_at > :since', { since: q.sinceDate }).orWhere(
            new Brackets((b2) => {
              b2.where('e.occurred_at = :since', { since: q.sinceDate }).andWhere('e.id > :sinceId', {
                sinceId: q.sinceId,
              });
            }),
          );
        }),
      );
    } else if (q.sinceDate) {
      qb.andWhere('e.occurred_at > :since', { since: q.sinceDate });
    }
    qb.orderBy('e.occurred_at', 'ASC').addOrderBy('e.id', 'ASC').take(q.limit);

    const rows = await qb.getMany();

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

    const last = events.length ? events[events.length - 1] : null;
    const nextCursor = last ? encodeEventsCursor(last.occurredAt, last.id) : null;
    return { events, nextCursor };
  }

  /**
   * POS-INT-107 — shift amplitude for a store on a given day. Reads the
   * cash_session.opened + employee_activity.recorded(closed) lifecycle events
   * from the outbox and pairs them into per-shift records + per-employee totals.
   * Tenant-scoped, read-only (TimeWin presence / Analytik R occupancy).
   */
  async shiftsForDay(
    storeId: string,
    date: string,
  ): Promise<ShiftSummary & { storeId: string; date: string }> {
    const { start, end } = dayRangeUtc(date);
    const rows = await this.events.find({
      where: {
        storeId,
        occurredAt: Between(start, end),
        type: In(['cash_session.opened', 'employee_activity.recorded']),
      },
      order: { occurredAt: 'ASC', id: 'ASC' },
    });
    const summary = summarizeShifts(toShiftEvents(rows));
    return { storeId, date, ...summary };
  }

  /** CSV variant of shiftsForDay (payroll / TimeWin handoff). */
  async shiftsForDayCsv(storeId: string, date: string): Promise<string> {
    return shiftsToCsv(await this.shiftsForDay(storeId, date));
  }

  /** Outbox delivery stats for a store (counts per status/type + backlog). */
  async stats(storeId: string): Promise<OutboxStats> {
    const grouped = await this.events
      .createQueryBuilder('e')
      .select('e.status', 'status')
      .addSelect('e.type', 'type')
      .addSelect('COUNT(*)', 'count')
      .where('e.store_id = :storeId', { storeId })
      .groupBy('e.status')
      .addGroupBy('e.type')
      .getRawMany();
    return shapeOutboxStats(
      grouped.map((r: any) => ({ status: r.status, type: r.type, count: Number(r.count) })),
    );
  }
}
