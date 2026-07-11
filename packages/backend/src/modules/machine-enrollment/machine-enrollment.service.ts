import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  PosMachineEntity,
  PosMachineStatus,
} from '../../database/entities/pos-machine.entity';
import { RequestEnrollmentDto } from './dto/machine-enrollment.dto';

/**
 * Décision de la barrière d'enrôlement (PURE — testable sans base).
 *
 * Une vente est autorisée quand :
 *  - le magasin n'applique pas l'enrôlement (`enforced === false`), OU
 *  - une machine `approved` pour CE magasin est présentée.
 *
 * Tout le reste (pas de machine, pending, rejected, revoked, machine d'un
 * autre magasin) bloque quand l'enrôlement est appliqué.
 */
export function evaluateEnrollmentGate(input: {
  enforced: boolean;
  storeId: string;
  machine: Pick<PosMachineEntity, 'status' | 'storeId'> | null;
}): { allowed: boolean; reason?: string } {
  if (!input.enforced) return { allowed: true };
  if (!input.machine) {
    return { allowed: false, reason: 'MACHINE_NOT_ENROLLED' };
  }
  if (input.machine.storeId !== input.storeId) {
    return { allowed: false, reason: 'MACHINE_STORE_MISMATCH' };
  }
  if (input.machine.status !== 'approved') {
    return { allowed: false, reason: `MACHINE_${input.machine.status.toUpperCase()}` };
  }
  return { allowed: true };
}

@Injectable()
export class MachineEnrollmentService {
  private readonly logger = new Logger(MachineEnrollmentService.name);

  constructor(
    @InjectRepository(PosMachineEntity)
    private readonly machineRepo: Repository<PosMachineEntity>,
  ) {}

  /**
   * Déclaration d'identité par la caisse. Idempotent par `machineId` :
   *  - machine inconnue → nouvelle demande `pending` ;
   *  - déjà `approved` → renvoyée telle quelle (aucune régression) ;
   *  - `pending` → mise à jour des libellés, reste `pending` ;
   *  - `rejected` / `revoked` → ré-ouverture en `pending` (re-soumission).
   *
   * Le magasin (`storeId`) vient du tenant JWT, jamais du corps de la requête.
   */
  async requestEnrollment(
    storeId: string,
    dto: RequestEnrollmentDto,
    requestedBy?: string | null,
  ): Promise<PosMachineEntity> {
    const existing = await this.machineRepo.findOne({
      where: { machineId: dto.machineId },
    });

    if (existing) {
      // Une machine approuvée reste approuvée — la re-déclaration ne dégrade pas.
      existing.terminalLabel = dto.terminalLabel;
      existing.machineName = dto.machineName ?? existing.machineName;
      existing.platform = dto.platform ?? existing.platform;
      existing.appVersion = dto.appVersion ?? existing.appVersion;
      existing.lastSeenAt = new Date();
      // Une machine approuvée pour un AUTRE magasin ne peut pas se réassigner
      // silencieusement : on ré-ouvre une demande pour le nouveau magasin.
      if (existing.status !== 'approved' || existing.storeId !== storeId) {
        if (existing.status === 'rejected' || existing.status === 'revoked' || existing.storeId !== storeId) {
          existing.storeId = storeId;
          existing.status = 'pending';
          existing.decidedBy = null;
          existing.decidedAt = null;
          existing.decisionReason = null;
          existing.requestedBy = requestedBy ?? existing.requestedBy;
        }
      }
      return this.machineRepo.save(existing);
    }

    const machine = this.machineRepo.create({
      machineId: dto.machineId,
      storeId,
      terminalLabel: dto.terminalLabel,
      machineName: dto.machineName ?? null,
      platform: dto.platform ?? null,
      appVersion: dto.appVersion ?? null,
      status: 'pending',
      requestedBy: requestedBy ?? null,
      lastSeenAt: new Date(),
    });
    this.logger.log(
      `Nouvelle demande d'enrôlement: machine=${dto.machineId} store=${storeId}`,
    );
    return this.machineRepo.save(machine);
  }

  /** Statut courant d'une machine (pour le polling de la caisse). */
  async getByMachineId(machineId: string): Promise<PosMachineEntity | null> {
    return this.machineRepo.findOne({ where: { machineId } });
  }

  /** Liste des machines d'un magasin, optionnellement filtrée par statut. */
  async listByStore(
    storeId: string,
    status?: PosMachineStatus,
  ): Promise<PosMachineEntity[]> {
    return this.machineRepo.find({
      where: status ? { storeId, status } : { storeId },
      order: { createdAt: 'DESC' },
    });
  }

  private async findById(id: string): Promise<PosMachineEntity> {
    const m = await this.machineRepo.findOne({ where: { id } });
    if (!m) throw new NotFoundException(`Machine ${id} introuvable.`);
    return m;
  }

  async approve(id: string, decidedBy: string): Promise<PosMachineEntity> {
    const m = await this.findById(id);
    m.status = 'approved';
    m.decidedBy = decidedBy;
    m.decidedAt = new Date();
    m.decisionReason = null;
    this.logger.log(`Machine ${m.machineId} approuvée par ${decidedBy}`);
    return this.machineRepo.save(m);
  }

  async reject(
    id: string,
    decidedBy: string,
    reason?: string,
  ): Promise<PosMachineEntity> {
    const m = await this.findById(id);
    m.status = 'rejected';
    m.decidedBy = decidedBy;
    m.decidedAt = new Date();
    m.decisionReason = reason ?? null;
    return this.machineRepo.save(m);
  }

  async revoke(
    id: string,
    decidedBy: string,
    reason?: string,
  ): Promise<PosMachineEntity> {
    const m = await this.findById(id);
    m.status = 'revoked';
    m.decidedBy = decidedBy;
    m.decidedAt = new Date();
    m.decisionReason = reason ?? null;
    this.logger.log(`Machine ${m.machineId} révoquée par ${decidedBy}`);
    return this.machineRepo.save(m);
  }
}
