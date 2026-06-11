import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, EntityManager } from 'typeorm';

import { OperatorAttributionEntity } from '../../database/entities/operator-attribution.entity';
import { PosSessionEntity } from '../../database/entities/pos-session.entity';

export type AttributionEventType = 'sale' | 'void' | 'return';

/**
 * Operator attribution service — (1b) binding, option (i), side-table.
 *
 * Records, in the SAME transaction as a fiscal event, which operator the
 * active terminal session attributes the event to. NON-AUTHORITATIVE:
 * nothing here feeds a hash or a fiscal export. The authoritative operator
 * stays the JWT value on the event's own employee_id.
 *
 * The record is written via the event's own transaction manager so it
 * commits atomically with the event (no orphan attribution, no event
 * without its observation).
 */
@Injectable()
export class OperatorAttributionService {
  private readonly logger = new Logger(OperatorAttributionService.name);

  constructor(
    @InjectRepository(OperatorAttributionEntity)
    private readonly repo: Repository<OperatorAttributionEntity>,
  ) {}

  /**
   * Insert one attribution row using the caller's transaction manager, so it
   * is atomic with the event. Insert-only — never updates.
   *
   * @param manager  the event's transaction EntityManager (same tx).
   * @param eventType 'sale' | 'void' | 'return'.
   * @param eventId   the event row id (sales.id / fiscal_journal.id / credit_notes.id).
   * @param storeId   the event's store.
   * @param terminalId the X-Terminal-Id claimed by the request (may be null).
   * @param session   the active session for that terminal, or null (no_session).
   */
  async recordWithinTransaction(
    manager: EntityManager,
    params: {
      eventType: AttributionEventType;
      eventId: string;
      storeId: string;
      terminalId: string | null;
      session: PosSessionEntity | null;
    },
  ): Promise<void> {
    const { eventType, eventId, storeId, terminalId, session } = params;
    const row = new OperatorAttributionEntity();
    row.eventType = eventType;
    row.eventId = eventId;
    row.storeId = storeId;
    row.sessionTerminalId = terminalId ?? null;
    row.sessionOperatorId = session ? session.employeeId : null;
    row.attributionSource = session ? 'session' : 'no_session';
    await manager.insert(OperatorAttributionEntity, row);
  }

  /** Read the attribution for a given event (tests, divergence inspection). */
  async findByEvent(
    eventType: AttributionEventType,
    eventId: string,
  ): Promise<OperatorAttributionEntity | null> {
    return this.repo.findOne({ where: { eventType, eventId } });
  }

  /**
   * Divergence metric (the v3-decision input).
   *
   * For 'sale': join operator_attribution to sales on event_id and compare
   * the authoritative sales.employee_id (JWT, hashed) to session_operator_id
   * (the session's view). A diverging row means the JWT operator and the
   * terminal-session operator disagree — the exact signal that justifies (or
   * kills) the v3 bascule. Counted only where a session was found.
   *
   * Returns { total, withSession, diverged }. converge-always (diverged=0)
   * → session adds nothing fiscal; diverged>0 → measured attribution gap.
   */
  async saleDivergenceForStore(
    storeId: string,
  ): Promise<{ total: number; withSession: number; diverged: number }> {
    const rows: Array<{ total: string; with_session: string; diverged: string }> =
      await this.repo.query(
        // COUNT(CASE WHEN ... THEN 1 END) instead of COUNT(*) FILTER (WHERE):
        // equivalent and correct in real Postgres, and pg-mem-compatible
        // (pg-mem mis-evaluates FILTER).
        //
        // <> instead of IS DISTINCT FROM is null-safe HERE because BOTH
        // operands are non-null:
        //   - session_operator_id: non-null within attribution_source='session'
        //     (= the session's employeeId, by construction in record…).
        //   - sales.employee_id: `varchar NOT NULL` (InitialSchema migration).
        // ASSUMPTION: if sales.employee_id ever becomes nullable, this metric
        // would silently undercount divergence (a null vs a value reads as
        // "equal" under <>). Revert to IS DISTINCT FROM (prod) and a pg-mem
        // workaround at that point. Low severity — this is the observability
        // metric, not a fiscal invariant.
        `SELECT
           COUNT(*)::int AS total,
           COUNT(CASE WHEN oa.attribution_source = 'session' THEN 1 END)::int AS with_session,
           COUNT(CASE WHEN oa.attribution_source = 'session'
                       AND oa.session_operator_id <> s.employee_id
                      THEN 1 END)::int AS diverged
         FROM operator_attribution oa
         JOIN sales s ON s.id = oa.event_id
         WHERE oa.event_type = 'sale' AND oa.store_id = $1`,
        [storeId],
      );
    const r = rows[0] ?? { total: '0', with_session: '0', diverged: '0' };
    return {
      total: Number(r.total),
      withSession: Number(r.with_session),
      diverged: Number(r.diverged),
    };
  }
}
