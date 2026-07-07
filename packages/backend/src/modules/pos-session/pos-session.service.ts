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
import { SalePaymentEntity } from '../../database/entities/sale-payment.entity';
import { CreditNoteEntity } from '../../database/entities/credit-note.entity';
import { normalizeShiftRecords, findEndedShiftFor } from '../shift-reminders/shift-normalize.util';
import { TimewinService } from '../timewin/timewin.service';
import { AuditService } from '../audit/audit.service';
import { EmployeeScoreService } from '../employee-score/employee-score.service';
import { classifyCashDifference } from '../employee-score/employee-score.constants';

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
    // Score is OPTIONAL too — a session must open/close even if scoring is down,
    // and the primitive's unit specs construct the service with the repo alone.
    @Optional() private readonly scoreService?: EmployeeScoreService,
    // OPTIONAL: used only to DERIVE the expected cash (sum of the session's cash
    // sale legs) at close. Absent in the primitive's bare unit specs.
    @Optional()
    @InjectRepository(SalePaymentEntity)
    private readonly paymentRepo?: Repository<SalePaymentEntity>,
    // OPTIONAL: cash refunds bound to the session (credit_notes.session_id) are
    // deducted from the expected cash. Absent in the bare unit specs.
    @Optional()
    @InjectRepository(CreditNoteEntity)
    private readonly creditNoteRepo?: Repository<CreditNoteEntity>,
  ) {}

  /**
   * Sum of the ESPÈCES legs really captured on the completed (non-voided) sales
   * bound to this session — derived SERVER-SIDE from persisted sales, never from
   * a client-declared figure. Returns 0 when the repo is unavailable.
   */
  private async computeSessionCashSales(sessionId: string): Promise<number> {
    if (!this.paymentRepo) return 0;
    const row = await this.paymentRepo
      .createQueryBuilder('p')
      .innerJoin('p.sale', 's')
      .select('COALESCE(SUM(p.amount_minor_units), 0)', 'sum')
      .where('s.session_id = :sessionId', { sessionId })
      .andWhere("s.status <> 'voided'")
      .andWhere("p.method = 'cash'")
      .andWhere('p.captured = true')
      .getRawOne<{ sum: string }>();
    return row ? parseInt(row.sum, 10) || 0 : 0;
  }

  /**
   * Somme des remboursements ESPÈCES rattachés à cette session — dérivée des
   * avoirs serveur (credit_notes.session_id, refund_method='cash', non
   * annulés), jamais d'une déclaration client. Seul un remboursement PROUVÉ
   * sur cette session diminue l'attendu ; un remboursement espèces non
   * rattaché (replay offline après fermeture) apparaîtra dans l'écart — un
   * fait, pas une approximation.
   */
  private async computeSessionCashRefunds(sessionId: string): Promise<number> {
    if (!this.creditNoteRepo) return 0;
    const row = await this.creditNoteRepo
      .createQueryBuilder('c')
      .select('COALESCE(SUM(c.total_minor_units), 0)', 'sum')
      .where('c.session_id = :sessionId', { sessionId })
      .andWhere("c.refund_method = 'cash'")
      .andWhere("c.status <> 'cancelled'")
      .getRawOne<{ sum: string }>();
    return row ? parseInt(row.sum, 10) || 0 : 0;
  }

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
      ?.pushEvent(
        session.storeId,
        event,
        session.employeeId,
        { sessionId: session.id, terminalId: session.terminalId },
        `${event}:${session.id}`, // idempotency key: a session opens/closes exactly once
      )
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

    // Feed the employee score (best-effort). A correctly closed session is
    // neutral; the abandoned/force-closed cases are logged elsewhere.
    if (this.scoreService) {
      await this.scoreService
        .logEvent({
          employeeId: session.employeeId,
          storeId: session.storeId,
          eventType: event === 'session.opened' ? 'SESSION_OPENED' : 'SESSION_CLOSED',
          terminalId: session.terminalId,
          sessionId: session.id,
          createdBy: session.employeeId,
          source: 'pos',
        })
        .catch((e: any) => this.logger.warn(`[score ${event}] ${e?.message}`));
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
      openingCashMinorUnits?: number;
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
    session.openingCashMinorUnits =
      typeof options.openingCashMinorUnits === 'number' ? options.openingCashMinorUnits : null;

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
    // Fire-and-forget : la conformité planning n'a JAMAIS le droit de bloquer
    // ou ralentir l'ouverture d'une session (TW24 peut être down).
    void this.observeShiftCompliance(saved).catch((e: any) =>
      this.logger.warn(`[shift compliance] ${e?.message}`),
    );
    return saved;
  }

  /**
   * Conformité planning TW24 (best-effort, probant uniquement) : si le feed
   * today-shifts fournit une fin de shift (`endsAt`) ET l'identité employé
   * (`employeeId`), et que TOUS les shifts du jour de cet employé sont
   * terminés, la session vient d'être ouverte APRÈS la fin de service →
   * EMPLOYEE_SESSION_OPEN_AFTER_SHIFT_END (rattaché session/terminal).
   * Données absentes ou ambiguës (pas de endsAt, pas d'employeeId, shift en
   * cours, coupure) → AUCUN événement. Jamais bloquant, jamais approximatif.
   */
  private async observeShiftCompliance(session: PosSessionEntity): Promise<void> {
    if (!this.timewin || !this.scoreService) return;
    let raw: unknown;
    try {
      raw = await this.timewin.getTodayShifts(session.storeId);
    } catch {
      return; // TW24 down/circuit open → inconnaissable, rien à signaler
    }
    const ended = findEndedShiftFor(normalizeShiftRecords(raw), session.employeeId, new Date());
    if (!ended) return;
    await this.scoreService
      .logEvent({
        employeeId: session.employeeId,
        storeId: session.storeId,
        eventType: 'EMPLOYEE_SESSION_OPEN_AFTER_SHIFT_END',
        terminalId: session.terminalId,
        sessionId: session.id,
        reason: `Session ouverte après la fin de shift (${ended.endsAt!.toISOString()})`,
        metadata: { shiftId: ended.id, shiftEndsAt: ended.endsAt!.toISOString() },
        createdBy: session.employeeId,
        source: 'pos',
      })
      .catch((e: any) => this.logger.warn(`[score shift_end] ${e?.message}`));
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
    options: { countedCashMinorUnits?: number; skipReason?: string } = {},
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

    // ── Cash count (optionnel) : attendu SERVEUR vs compté RÉEL ─────────────
    // Le compté est la seule valeur venant du client ; l'attendu et l'écart
    // sont dérivés côté serveur des ventes rattachées à cette session.
    const counted = options.countedCashMinorUnits;
    const skipReason = options.skipReason?.trim();
    if (typeof counted === 'number') {
      const cashSales = await this.computeSessionCashSales(session.id);
      const cashRefunds = await this.computeSessionCashRefunds(session.id);
      const opening = session.openingCashMinorUnits ?? 0;
      // attendu = fond + ventes espèces − remboursements espèces (tous dérivés serveur)
      const expected = opening + cashSales - cashRefunds;
      session.cashSalesMinorUnits = cashSales;
      session.cashRefundsMinorUnits = cashRefunds;
      session.expectedCashMinorUnits = expected;
      session.countedCashMinorUnits = counted;
      session.cashDifferenceMinorUnits = counted - expected;
      session.cashCountedAt = new Date();
    } else if (skipReason) {
      // Fermeture explicite SANS comptage : encadrée (motif obligatoire),
      // jamais une échappatoire muette. La résilience reste : une fermeture
      // silencieuse (logout/abandon) n'envoie pas de motif et n'entre pas ici.
      session.cashCountSkippedReason = skipReason;
      session.cashCountSkippedAt = new Date();
    }

    const saved = await this.repo.save(session);
    this.logger.log(`POS session closed: ${saved.id}`);
    await this.observeSession(saved, 'session.closed');

    // Score + audit (best-effort, jamais bloquant).
    if (typeof counted === 'number') {
      await this.observeCashCount(saved);
    } else if (skipReason) {
      await this.observeCashCountSkipped(saved);
    }
    return saved;
  }

  /**
   * Journalise une fermeture sans comptage MOTIVÉE : audit
   * `pos_session_cash_count_skipped` + événement de score CASH_COUNT_SKIPPED
   * (rattaché session/terminal/employé, alerte manager). Best-effort.
   */
  private async observeCashCountSkipped(session: PosSessionEntity): Promise<void> {
    if (this.audit) {
      try {
        await this.audit.log({
          storeId: session.storeId,
          employeeId: session.employeeId,
          action: 'pos_session_cash_count_skipped',
          entityType: 'pos_session',
          entityId: session.id,
          details: {
            terminalId: session.terminalId,
            reason: session.cashCountSkippedReason,
            at: new Date().toISOString(),
          },
        });
      } catch (e: any) {
        this.logger.warn(`[audit cash_skip] ${e?.message}`);
      }
    }
    if (this.scoreService) {
      await this.scoreService
        .logEvent({
          employeeId: session.employeeId,
          storeId: session.storeId,
          eventType: 'CASH_COUNT_SKIPPED',
          terminalId: session.terminalId,
          sessionId: session.id,
          createdBy: session.employeeId,
          source: 'pos',
          reason: session.cashCountSkippedReason ?? undefined,
        })
        .catch((e: any) => this.logger.warn(`[score cash_skip] ${e?.message}`));
    }
  }

  /**
   * Journalise le comptage de caisse : événement de score (comptage terminé +
   * classification de l'écart en CASH_DIFFERENCE_* rattaché à la session, au
   * terminal et à l'employé) et entrée d'audit décomposant attendu/compté/écart.
   * Entièrement best-effort — un échec ici ne remet pas en cause la fermeture.
   */
  private async observeCashCount(session: PosSessionEntity): Promise<void> {
    const expected = session.expectedCashMinorUnits ?? 0;
    const counted = session.countedCashMinorUnits ?? 0;
    const difference = session.cashDifferenceMinorUnits ?? 0;

    if (this.audit) {
      try {
        await this.audit.log({
          storeId: session.storeId,
          employeeId: session.employeeId,
          action: 'pos_session_cash_counted',
          entityType: 'pos_session',
          entityId: session.id,
          details: {
            terminalId: session.terminalId,
            openingCashMinorUnits: session.openingCashMinorUnits,
            cashSalesMinorUnits: session.cashSalesMinorUnits,
            cashRefundsMinorUnits: session.cashRefundsMinorUnits,
            expectedCashMinorUnits: expected,
            countedCashMinorUnits: counted,
            cashDifferenceMinorUnits: difference,
            openingCashKnown: session.openingCashMinorUnits != null,
            at: new Date().toISOString(),
          },
        });
      } catch (e: any) {
        this.logger.warn(`[audit cash_count] ${e?.message}`);
      }
    }

    if (this.scoreService) {
      // Comptage terminé (neutre) + écart classé (mineur/majeur/critique).
      await this.scoreService
        .logEvent({
          employeeId: session.employeeId,
          storeId: session.storeId,
          eventType: 'CASH_COUNT_COMPLETED',
          terminalId: session.terminalId,
          sessionId: session.id,
          createdBy: session.employeeId,
          source: 'pos',
          reason: `Attendu ${expected} / compté ${counted} / écart ${difference} (centimes)`,
        })
        .catch((e: any) => this.logger.warn(`[score cash_count] ${e?.message}`));

      const diffEvent = classifyCashDifference(difference);
      if (diffEvent) {
        await this.scoreService
          .logEvent({
            employeeId: session.employeeId,
            storeId: session.storeId,
            eventType: diffEvent,
            terminalId: session.terminalId,
            sessionId: session.id,
            createdBy: session.employeeId,
            source: 'pos',
            reason: `Écart caisse ${difference} centimes (attendu ${expected}, compté ${counted})`,
            metadata: {
              expectedCashMinorUnits: expected,
              countedCashMinorUnits: counted,
              cashDifferenceMinorUnits: difference,
            },
          })
          .catch((e: any) => this.logger.warn(`[score cash_diff] ${e?.message}`));
      }
    }
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

  /**
   * Liste les sessions récentes d'un magasin (lecture manager/admin) — la source
   * probante des écarts caisse : chaque ligne porte l'employé, le terminal, les
   * horodatages et le comptage (attendu/compté/écart, dérivés serveur). Tenant-
   * scoped : le storeId vient de `req.tenantStoreId`/JWT, jamais du client.
   */
  async listSessions(
    storeId: string,
    opts: { limit?: number; activeOnly?: boolean; withCashCountOnly?: boolean } = {},
  ): Promise<PosSessionEntity[]> {
    const qb = this.repo
      .createQueryBuilder('s')
      .where('s.store_id = :storeId', { storeId })
      .orderBy('s.opened_at', 'DESC')
      .take(Math.min(opts.limit ?? 100, 500));
    if (opts.activeOnly) qb.andWhere('s.is_active = true');
    if (opts.withCashCountOnly) qb.andWhere('s.cash_counted_at IS NOT NULL');
    return qb.getMany();
  }
}
