import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { AccessAuditLogEntity } from '../../database/entities/access-audit-log.entity';
import { AlertService } from '../../common/alert/alert.service';
import { computeAuditHashV2 } from '../audit/audit.service';
import { AccessAuditEvent } from './access-audit.events';

const GENESIS_HASH = '0000000000000000000000000000000000000000000000000000000000000000';

export interface AppendAccessAuditParams {
  scope?: string;
  actorEmployeeId: string;
  actorUserId?: string | null;
  targetEmployeeId?: string | null;
  eventType: AccessAuditEvent;
  storeId?: string | null;
  previousValue?: Record<string, unknown> | null;
  newValue?: Record<string, unknown> | null;
  reason?: string | null;
  ipAddress?: string | null;
  sessionId?: string | null;
}

/**
 * Reconstruit le payload haché EXACTEMENT depuis les champs — utilisé à l'écriture ET à
 * la vérification, pour que verifyChain recompute à l'identique. Réutilise la forme et
 * la fonction de hash prouvées du module `audit` (computeAuditHashV2 + canonicalize).
 */
function hashPayload(row: {
  scope: string;
  actorEmployeeId: string;
  actorUserId: string | null;
  targetEmployeeId: string | null;
  eventType: string;
  storeId: string | null;
  previousValue: Record<string, unknown> | null;
  newValue: Record<string, unknown> | null;
  reason: string | null;
  ipAddress: string | null;
  sessionId: string | null;
  hashedAt: string;
}) {
  return {
    storeId: row.scope,
    employeeId: row.actorEmployeeId,
    action: row.eventType,
    entityType: 'access',
    entityId: row.targetEmployeeId ?? '',
    details: {
      actorUserId: row.actorUserId ?? null,
      storeId: row.storeId ?? null,
      previousValue: row.previousValue ?? null,
      newValue: row.newValue ?? null,
      reason: row.reason ?? null,
      ip: row.ipAddress ?? null,
      sessionId: row.sessionId ?? null,
    },
    timestamp: row.hashedAt,
  };
}

/**
 * Journal d'audit des DROITS — append-only, hash-chaîné. Miroir de AuditService :
 * mutex par scope + retry anti-fork sur violation d'unicité (scope, previous_hash).
 */
@Injectable()
export class AccessAuditService {
  private readonly logger = new Logger(AccessAuditService.name);
  private readonly scopeLocks = new Map<string, Promise<any>>();

  constructor(
    @InjectRepository(AccessAuditLogEntity)
    private readonly repo: Repository<AccessAuditLogEntity>,
  ) {}

  async append(params: AppendAccessAuditParams): Promise<AccessAuditLogEntity> {
    const scope = params.scope || 'global';
    const previousLock = this.scopeLocks.get(scope) || Promise.resolve();
    const currentLock = previousLock.catch(() => {}).then(() => this.doAppend(scope, params));
    this.scopeLocks.set(scope, currentLock);
    try {
      return await currentLock;
    } finally {
      if (this.scopeLocks.get(scope) === currentLock) this.scopeLocks.delete(scope);
    }
  }

  private async doAppend(scope: string, params: AppendAccessAuditParams): Promise<AccessAuditLogEntity> {
    const MAX_ATTEMPTS = 4;
    let lastErr: unknown;
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const head = await this.repo.findOne({ where: { scope }, order: { occurredAt: 'DESC' } });
      const previousHash = head?.hash || GENESIS_HASH;
      const ts = new Date();
      const hashedAt = ts.toISOString();

      const row = {
        scope,
        actorEmployeeId: params.actorEmployeeId,
        actorUserId: params.actorUserId ?? null,
        targetEmployeeId: params.targetEmployeeId ?? null,
        eventType: params.eventType,
        storeId: params.storeId ?? null,
        previousValue: params.previousValue ?? null,
        newValue: params.newValue ?? null,
        reason: params.reason ?? null,
        ipAddress: params.ipAddress ?? null,
        sessionId: params.sessionId ?? null,
        hashedAt,
      };
      const hash = computeAuditHashV2(previousHash, hashPayload(row));
      const entry = this.repo.create({ id: uuidv4(), ...row, previousHash, hash, occurredAt: ts });

      try {
        return await this.repo.save(entry);
      } catch (e: unknown) {
        if (!this.isUniqueViolation(e)) throw e;
        lastErr = e; // fork: head bougé → re-chaîner
      }
    }
    AlertService.instance.fire(
      'ACCESS_AUDIT_WRITE_FAILED',
      `Access-audit append dropped after ${MAX_ATTEMPTS} attempts — scope ${scope}, event ${params.eventType}, target ${params.targetEmployeeId}`,
    );
    throw lastErr;
  }

  private isUniqueViolation(e: unknown): boolean {
    const err = e as { code?: string; message?: string };
    return err?.code === '23505' || /unique|duplicate key/i.test(err?.message ?? '');
  }

  async list(scope = 'global', limit = 100, offset = 0): Promise<AccessAuditLogEntity[]> {
    return this.repo.find({ where: { scope }, order: { occurredAt: 'DESC' }, take: limit, skip: offset });
  }

  /**
   * Vérifie la chaîne : (1) LINKAGE (previous_hash pointe le hash précédent) et
   * (2) RECOMPUTE (hash re-dérivé des colonnes vivantes). Détecte insertion/suppression
   * ET altération de valeurs / ré-attribution d'acteur. Lecture seule.
   */
  async verifyChain(
    scope = 'global',
  ): Promise<{ valid: boolean; brokenAt?: string; reason?: 'linkage' | 'hash_mismatch' }> {
    const rows = await this.repo.find({ where: { scope }, order: { occurredAt: 'ASC' } });
    let expectedPrev = GENESIS_HASH;
    for (const r of rows) {
      if (r.previousHash !== expectedPrev) {
        return { valid: false, brokenAt: r.id, reason: 'linkage' };
      }
      const recomputed = computeAuditHashV2(r.previousHash, hashPayload(r));
      if (recomputed !== r.hash) {
        return { valid: false, brokenAt: r.id, reason: 'hash_mismatch' };
      }
      expectedPrev = r.hash;
    }
    return { valid: true };
  }
}
