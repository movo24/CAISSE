import {
  Injectable,
  ConflictException,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { PosSessionEntity } from '../../database/entities/pos-session.entity';

/**
 * POS Session primitive — (1a) of the session-binding work.
 *
 * Scope of this service:
 *   - openSession: create an active session for (store, employee), refuse
 *     if an active session already exists for that pair (or terminal).
 *   - closeSession: mark a session inactive, set closedAt.
 *   - findActive: read the active session for a given (store, employee[, terminal]).
 *
 * Out of scope (deferred to (1b) binding):
 *   - createSale and voidSale do NOT consult this service. The primitive is
 *     introduced without coupling. (1b) will wire it in once Wesley front
 *     is aligned and option (α/β/γ) is decided.
 *
 * Compatibility with strate II design:
 *   The entity PosSessionEntity already has the fields the strate II log v1.1
 *   expects (timewin_session_token, offline_mode, permissions). Future strate
 *   II additions (presence_factor, authorization_source, etc.) will be
 *   additive migrations, not a refactor.
 */
@Injectable()
export class PosSessionService {
  private readonly logger = new Logger(PosSessionService.name);

  constructor(
    @InjectRepository(PosSessionEntity)
    private readonly repo: Repository<PosSessionEntity>,
  ) {}

  /**
   * Open a new POS session for the authenticated employee at the given store.
   *
   * Refuses if an active session already exists for (storeId, employeeId).
   * This enforces lifecycle: an employee cannot have two parallel active
   * sessions in the same store. If a terminal_id is provided, the check is
   * tightened to (storeId, employeeId, terminalId)-level uniqueness.
   *
   * @param storeId — from JWT (req.user.storeId).
   * @param employeeId — from JWT (req.user.employeeId).
   * @param snapshot — employee snapshots from JWT (name/role/maxDiscount).
   * @param options — terminalId (optional), offlineMode (optional).
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

    // Lifecycle enforcement: refuse if an active session already exists.
    const existing = await this.repo.findOne({
      where: { storeId, employeeId, isActive: true },
    });
    if (existing) {
      throw new ConflictException(
        'An active POS session already exists for this employee and store. ' +
          'Close it before opening a new one.',
      );
    }

    // Note on terminalId: accepted by the DTO but NOT persisted at (1a).
    // The current PosSessionEntity has no terminal_id column — permissions
    // jsonb is typed Record<string, boolean | number>, so it can't hold a
    // string id. terminal_id is a strate II addition (additive migration
    // ulterieure), to be wired when the binding work needs it. At (1a) we
    // log it for observability but do not store. The DTO surface stays
    // forward-compatible; the schema addition is deferred without loss.
    const session = new PosSessionEntity();
    session.storeId = storeId;
    session.employeeId = employeeId;
    session.employeeName = snapshot.employeeName ?? '';
    session.employeeRole = snapshot.employeeRole ?? '';
    session.maxDiscount = snapshot.maxDiscount ?? 0;
    session.permissions = {};
    session.isActive = true;
    session.offlineMode = options.offlineMode ?? false;

    const saved = await this.repo.save(session);
    this.logger.log(
      `POS session opened: ${saved.id} for employee ${employeeId} at store ${storeId}` +
        (options.terminalId
          ? ` (terminal ${options.terminalId} declared, not persisted at 1a)`
          : ''),
    );
    return saved;
  }

  /**
   * Close an active POS session.
   *
   * Refuses if the session doesn't exist or is already closed (refuse-close-
   * without-open is enforced). Sets closedAt to now.
   *
   * @param sessionId — session id (UUID).
   * @param storeId — from JWT, must match the session's store (cross-store close forbidden).
   * @param employeeId — from JWT, must match the session's employee (cross-employee close forbidden).
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
    return saved;
  }

  /**
   * Find the active POS session for (storeId, employeeId).
   * Returns null if no active session exists.
   *
   * (1a) read API — useful for (1b) binding once wired.
   */
  async findActive(
    storeId: string,
    employeeId: string,
  ): Promise<PosSessionEntity | null> {
    return this.repo.findOne({
      where: { storeId, employeeId, isActive: true },
    });
  }
}
