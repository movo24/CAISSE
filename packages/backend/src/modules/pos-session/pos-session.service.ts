import {
  Injectable,
  ConflictException,
  NotFoundException,
  BadRequestException,
  Optional,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { PosSessionEntity } from '../../database/entities/pos-session.entity';
import { TimewinService } from '../timewin/timewin.service';
import { AuditService } from '../audit/audit.service';

/**
 * POS Session primitive — γ-model (D1 decision: terminal-bound sessions).
 *
 * /CAISSE targets shared-terminal retail: cashier + manager on the same
 * register, mid-shift handovers, future multi-store deployments. The
 * session is therefore anchored to the PHYSICAL TERMINAL, not to the
 * employee identity alone:
 *
 *   - Uniqueness invariant: ONE active session per (storeId, terminalId).
 *   - An employee MAY hold active sessions on several terminals.
 *   - A terminal can NEVER have two concurrent active sessions.
 *   - terminal_id comes from the X-Terminal-Id header at open — required,
 *     opening without it is refused.
 *
 * Scope of this service ((1a) of the session-binding work):
 *   - openSession / closeSession / findActiveForTerminal.
 *   - createSale and voidSale do NOT consult this service yet. The (1b)
 *     binding — sourcing the operator's employee_id from the terminal's
 *     active session (issue #4) — is a separate PR. Issue #4 stays OPEN
 *     until that lands. The manager-authorizer capture (who validated an
 *     over-limit void) is issue #5, kept strictly separate from #4.
 *
 * Strate II compatibility: terminal_id is also the binding anchor the
 * strate II producer log expects (token audience-bound to terminal).
 * Future strate II additions (presence_factor, authorization_source) are
 * additive migrations on this entity, not a refactor.
 */
@Injectable()
export class PosSessionService {
  private readonly logger = new Logger(PosSessionService.name);

  constructor(
    @InjectRepository(PosSessionEntity)
    private readonly repo: Repository<PosSessionEntity>,
    // Observability is OPTIONAL by construction: a session must open/close even
    // when TimeWin24 or the audit chain are unavailable (resilience), and the
    // primitive's unit specs construct the service with the repo alone.
    @Optional() private readonly timewin?: TimewinService,
    @Optional() private readonly audit?: AuditService,
  ) {}

  /**
   * Observe a session lifecycle event (Bloc 3.4/3.5 — TimeWin hardening):
   *  - push session.opened/closed to TimeWin24 (fire-and-forget; network never
   *    blocks the session lifecycle);
   *  - record a durable, attributable entry in the per-store audit chain — the
   *    connection history (who / when / which terminal) that was missing.
   * Both are best-effort: a failure is logged, never propagated.
   */
  private async observeSession(
    session: PosSessionEntity,
    event: 'session.opened' | 'session.closed',
  ): Promise<void> {
    this.timewin
      ?.pushEvent(session.storeId, event, session.employeeId, {
        sessionId: session.id,
        terminalId: session.terminalId,
      })
      .catch((e: any) => this.logger.warn(`[timewin ${event}] ${e?.message}`));

    if (this.audit) {
      try {
        await this.audit.log({
          storeId: session.storeId,
          employeeId: session.employeeId,
          action: event === 'session.opened' ? 'pos_session_opened' : 'pos_session_closed',
          entityType: 'pos_session',
          entityId: session.id,
          details: {
            terminalId: session.terminalId,
            employeeName: session.employeeName,
            at: new Date().toISOString(),
          },
        });
      } catch (e: any) {
        this.logger.warn(`[audit ${event}] ${e?.message}`);
      }
    }
  }

  /**
   * Open a new POS session on a physical terminal.
   *
   * Refuses if:
   *   - terminalId is missing (γ-model: sessions are terminal-bound);
   *   - an active session already exists for (storeId, terminalId),
   *     whoever owns it — the previous operator must close before the
   *     terminal accepts a new session.
   *
   * An employee opening on a SECOND terminal is allowed (relève, manager
   * roving between registers). Same terminal twice is not.
   *
   * @param storeId — from JWT (req.user.storeId).
   * @param employeeId — from JWT (req.user.employeeId).
   * @param snapshot — employee snapshots from JWT (name/role/maxDiscount).
   * @param options — terminalId (REQUIRED, from X-Terminal-Id header),
   *                  offlineMode (optional).
   */
  async openSession(
    storeId: string,
    employeeId: string,
    snapshot: {
      employeeName?: string;
      employeeRole?: string;
      maxDiscount?: number;
    },
    options: {
      terminalId?: string;
      offlineMode?: boolean;
    } = {},
  ): Promise<PosSessionEntity> {
    if (!storeId) {
      throw new BadRequestException('storeId is required to open a POS session');
    }
    if (!employeeId) {
      throw new BadRequestException('employeeId is required to open a POS session');
    }
    if (!options.terminalId) {
      throw new BadRequestException(
        'X-Terminal-Id header is required to open a POS session ' +
          '(sessions are terminal-bound)',
      );
    }

    // γ invariant: one active session per (store, terminal) — regardless of
    // which employee owns it.
    const existing = await this.repo.findOne({
      where: { storeId, terminalId: options.terminalId, isActive: true },
    });
    if (existing) {
      throw new ConflictException(
        'An active POS session already exists on this terminal. ' +
          'Close it before opening a new one.',
      );
    }

    const session = new PosSessionEntity();
    session.storeId = storeId;
    session.employeeId = employeeId;
    session.terminalId = options.terminalId;
    session.employeeName = snapshot.employeeName ?? '';
    session.employeeRole = snapshot.employeeRole ?? '';
    session.maxDiscount = snapshot.maxDiscount ?? 0;
    session.permissions = {};
    session.isActive = true;
    session.offlineMode = options.offlineMode ?? false;

    let saved: PosSessionEntity;
    try {
      saved = await this.repo.save(session);
    } catch (err: any) {
      // TOCTOU backstop: two concurrent opens on the same terminal can both
      // pass the check above; the partial unique index
      // (uq_pos_sessions_store_terminal_active) makes the second insert fail
      // atomically with unique_violation (23505). Map it to the same 409 the
      // check produces — the caller can't tell (and shouldn't) which line of
      // defense fired.
      //
      // INVARIANT of this catch: openSession is a SINGLE auto-commit INSERT
      // (no explicit transaction, no cascades on the entity). If a future
      // refactor wraps it in a multi-statement transaction, catch-and-map is
      // NOT enough — in real Postgres a 23505 aborts the whole transaction
      // ("current transaction is aborted" on every subsequent statement), so
      // a rollback must happen BEFORE throwing. pg-mem does not emulate the
      // aborted-transaction state, so tests would stay green while prod
      // breaks on the concurrent path. Re-verify this catch if open ever
      // joins a transaction.
      const code = err?.code ?? err?.driverError?.code;
      if (code === '23505' || /unique|duplicate/i.test(err?.message ?? '')) {
        throw new ConflictException(
          'An active POS session already exists on this terminal. ' +
            'Close it before opening a new one.',
        );
      }
      throw err;
    }
    this.logger.log(
      `POS session opened: ${saved.id} for employee ${employeeId} ` +
        `at store ${storeId} on terminal ${options.terminalId}`,
    );
    await this.observeSession(saved, 'session.opened');
    return saved;
  }

  /**
   * Close an active POS session.
   *
   * Refuses if the session doesn't exist, is already closed, or belongs to
   * a different store/employee (cross-store and cross-employee close
   * forbidden). Sets closedAt to now.
   */
  async closeSession(
    sessionId: string,
    storeId: string,
    employeeId: string,
  ): Promise<PosSessionEntity> {
    const session = await this.repo.findOne({ where: { id: sessionId } });
    if (!session) {
      throw new NotFoundException(`POS session ${sessionId} not found`);
    }
    if (session.storeId !== storeId) {
      throw new BadRequestException(
        'POS session belongs to a different store',
      );
    }
    if (session.employeeId !== employeeId) {
      throw new BadRequestException(
        'POS session belongs to a different employee',
      );
    }
    if (!session.isActive) {
      throw new ConflictException('POS session is already closed');
    }

    session.isActive = false;
    session.closedAt = new Date();
    const saved = await this.repo.save(session);
    this.logger.log(`POS session closed: ${saved.id}`);
    await this.observeSession(saved, 'session.closed');
    return saved;
  }

  /**
   * Find the active POS session for a terminal at a store.
   * Returns null if no active session exists.
   *
   * This is the primary read for the (1b) binding: "who operates THIS
   * terminal right now" — non-ambiguous under the γ invariant. A lookup
   * by employee would be ambiguous (an employee may hold several sessions).
   */
  async findActiveForTerminal(
    storeId: string,
    terminalId: string,
  ): Promise<PosSessionEntity | null> {
    if (!terminalId) {
      throw new BadRequestException(
        'X-Terminal-Id header is required to look up the active session',
      );
    }
    return this.repo.findOne({
      where: { storeId, terminalId, isActive: true },
    });
  }
}
