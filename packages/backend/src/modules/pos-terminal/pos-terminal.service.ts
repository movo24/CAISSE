import {
  Injectable,
  ConflictException,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { PosTerminalEntity } from '../../database/entities/pos-terminal.entity';

/**
 * POS terminal registry service — (1b) first brick.
 *
 * Provisioning (privileged) + the store-scoped validation the session/sale
 * paths will use to check an X-Terminal-Id claim.
 *
 * Scope boundary: this service does NOT bind operator → sale/void/return.
 * That is the binding brick (separate PR), where the dev-unblock vs
 * fiscal-production line (#4) and the createReturn symmetry (#7) are
 * decided. Here we only build the referent + the cross-store check.
 */
@Injectable()
export class PosTerminalService {
  private readonly logger = new Logger(PosTerminalService.name);

  constructor(
    @InjectRepository(PosTerminalEntity)
    private readonly repo: Repository<PosTerminalEntity>,
  ) {}

  /**
   * Provision a logical till for a store. Privileged op (authz at controller).
   *
   * Refuses a duplicate active terminal_code in the same store. The DB
   * partial unique index is the atomic arbiter (γ TOCTOU lesson): the
   * pre-check gives the friendly 409, the catch maps the race-loser's
   * unique_violation to the same 409.
   */
  async provision(
    storeId: string,
    terminalCode: string,
    label?: string,
  ): Promise<PosTerminalEntity> {
    if (!storeId) {
      throw new BadRequestException('storeId is required to provision a terminal');
    }
    if (!terminalCode || !terminalCode.trim()) {
      throw new BadRequestException('terminalCode is required and cannot be empty');
    }

    const code = terminalCode.trim();

    const existing = await this.repo.findOne({
      where: { storeId, terminalCode: code, isActive: true },
    });
    if (existing) {
      throw new ConflictException(
        `An active terminal with code "${code}" already exists in this store.`,
      );
    }

    const terminal = new PosTerminalEntity();
    terminal.storeId = storeId;
    terminal.terminalCode = code;
    terminal.label = label?.trim() || null;
    terminal.isActive = true;

    let saved: PosTerminalEntity;
    try {
      saved = await this.repo.save(terminal);
    } catch (err: any) {
      // TOCTOU backstop: concurrent provisioning of the same code both pass
      // the pre-check; the partial unique index makes the loser fail with
      // 23505. Map to the same 409. (Single auto-commit INSERT — no
      // transaction to roll back; see the γ commit for the guarded
      // invariant if this ever joins a multi-statement transaction.)
      const dbCode = err?.code ?? err?.driverError?.code;
      if (dbCode === '23505' || /unique|duplicate/i.test(err?.message ?? '')) {
        throw new ConflictException(
          `An active terminal with code "${code}" already exists in this store.`,
        );
      }
      throw err;
    }

    this.logger.log(
      `POS terminal provisioned: ${saved.id} code="${code}" store=${storeId}`,
    );
    return saved;
  }

  /** List active terminals for a store. */
  async findAllByStore(storeId: string): Promise<PosTerminalEntity[]> {
    return this.repo.find({
      where: { storeId, isActive: true },
      order: { terminalCode: 'ASC' },
    });
  }

  /** Update label and/or active flag. Soft-deactivate via isActive=false. */
  async update(
    id: string,
    storeId: string,
    patch: { label?: string; isActive?: boolean },
  ): Promise<PosTerminalEntity> {
    const terminal = await this.repo.findOne({ where: { id } });
    if (!terminal) {
      throw new NotFoundException(`POS terminal ${id} not found`);
    }
    if (terminal.storeId !== storeId) {
      throw new BadRequestException('POS terminal belongs to a different store');
    }
    if (patch.label !== undefined) {
      terminal.label = patch.label?.trim() || null;
    }
    if (patch.isActive !== undefined) {
      terminal.isActive = patch.isActive;
    }
    const saved = await this.repo.save(terminal);
    this.logger.log(`POS terminal updated: ${saved.id}`);
    return saved;
  }

  /**
   * Store-scoped validation of an X-Terminal-Id claim.
   *
   * This is the anti-cross-store check the session/sale paths consume:
   * returns the registered terminal IFF the claimed code exists and is
   * active in the GIVEN store. An operator scoped to store A cannot
   * validate a code that only exists in store B.
   *
   * IMPORTANT (#4): this stops CROSS-store spoofing only. It does NOT stop
   * INTRA-store spoofing (claiming Caisse-2 instead of Caisse-1 within the
   * same store) — both validate. Fiscal-authoritative attribution remains
   * gated on a device credential. This method is necessary, not sufficient.
   *
   * Returns the terminal, or null if the claim does not match an active
   * terminal in the store. Callers decide whether null means refuse.
   */
  async validateClaim(
    storeId: string,
    terminalCode: string,
  ): Promise<PosTerminalEntity | null> {
    if (!storeId || !terminalCode) return null;
    return this.repo.findOne({
      where: { storeId, terminalCode: terminalCode.trim(), isActive: true },
    });
  }
}
