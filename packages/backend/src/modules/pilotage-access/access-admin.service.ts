import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { EmployeeApplicationAccessEntity } from '../../database/entities/employee-application-access.entity';
import { EmployeeStoreAccessEntity } from '../../database/entities/employee-store-access.entity';
import { AccessAuditService } from './access-audit.service';
import { GrantApplicationAccessDto, GrantStoreAccessDto } from './access-admin.dto';

export interface ActorContext {
  actorEmployeeId: string;
  ipAddress?: string | null;
}

/**
 * Mutations d'accès (admin) — CHAQUE mutation écrit une entrée immuable dans
 * access_audit_log (via AccessAuditService). previous/new value tracés pour l'audit.
 * Un directeur ne peut PAS modifier son propre périmètre : le gating est fait au
 * contrôleur (@Roles('admin')) ; ce service est l'exécutant tracé.
 */
@Injectable()
export class AccessAdminService {
  constructor(
    @InjectRepository(EmployeeApplicationAccessEntity)
    private readonly appRepo: Repository<EmployeeApplicationAccessEntity>,
    @InjectRepository(EmployeeStoreAccessEntity)
    private readonly storeRepo: Repository<EmployeeStoreAccessEntity>,
    private readonly audit: AccessAuditService,
  ) {}

  async grantApplicationAccess(
    targetEmployeeId: string,
    dto: GrantApplicationAccessDto,
    actor: ActorContext,
  ): Promise<EmployeeApplicationAccessEntity> {
    const existing = await this.appRepo.findOne({ where: { employeeId: targetEmployeeId } });
    const previousValue = existing ? snapshotApp(existing) : null;

    const row =
      existing ??
      this.appRepo.create({ employeeId: targetEmployeeId, applicationRole: dto.applicationRole, createdBy: actor.actorEmployeeId });

    if (dto.applicationEnabled !== undefined) row.applicationEnabled = dto.applicationEnabled;
    row.applicationRole = dto.applicationRole;
    if (dto.permissionLevel !== undefined) row.permissionLevel = dto.permissionLevel;
    row.primaryStoreId = dto.primaryStoreId ?? row.primaryStoreId ?? null;
    // Présent (string OU null) ⇒ appliquer (null efface la borne) ; absent (undefined) ⇒ conserver.
    if (dto.validFrom !== undefined) row.validFrom = dto.validFrom ? new Date(dto.validFrom) : null;
    if (dto.validUntil !== undefined) row.validUntil = dto.validUntil ? new Date(dto.validUntil) : null;

    const saved = await this.appRepo.save(row);

    const eventType = !existing
      ? 'ACCESS_GRANTED'
      : previousValue?.applicationRole !== dto.applicationRole
        ? 'ROLE_CHANGED'
        : 'ACCESS_UPDATED';

    await this.audit.append({
      actorEmployeeId: actor.actorEmployeeId,
      targetEmployeeId,
      eventType,
      previousValue,
      newValue: snapshotApp(saved),
      reason: dto.reason ?? null,
      ipAddress: actor.ipAddress ?? null,
    });
    return saved;
  }

  async suspend(targetEmployeeId: string, reason: string | null, actor: ActorContext) {
    const row = await this.appRepo.findOne({ where: { employeeId: targetEmployeeId } });
    if (!row) throw new NotFoundException("Aucun accès application pour cet employé.");
    const previousValue = snapshotApp(row);
    row.suspendedAt = new Date();
    row.suspendedBy = actor.actorEmployeeId;
    const saved = await this.appRepo.save(row);
    await this.audit.append({
      actorEmployeeId: actor.actorEmployeeId,
      targetEmployeeId,
      eventType: 'ACCOUNT_SUSPENDED',
      previousValue,
      newValue: snapshotApp(saved),
      reason,
      ipAddress: actor.ipAddress ?? null,
    });
    return saved;
  }

  async reactivate(targetEmployeeId: string, actor: ActorContext) {
    const row = await this.appRepo.findOne({ where: { employeeId: targetEmployeeId } });
    if (!row) throw new NotFoundException("Aucun accès application pour cet employé.");
    const previousValue = snapshotApp(row);
    row.suspendedAt = null;
    row.suspendedBy = null;
    const saved = await this.appRepo.save(row);
    await this.audit.append({
      actorEmployeeId: actor.actorEmployeeId,
      targetEmployeeId,
      eventType: 'ACCOUNT_REACTIVATED',
      previousValue,
      newValue: snapshotApp(saved),
      ipAddress: actor.ipAddress ?? null,
    });
    return saved;
  }

  async grantStoreAccess(
    targetEmployeeId: string,
    storeId: string,
    dto: GrantStoreAccessDto,
    actor: ActorContext,
  ): Promise<EmployeeStoreAccessEntity> {
    const existing = await this.storeRepo.findOne({ where: { employeeId: targetEmployeeId, storeId } });
    const previousValue = existing ? snapshotStore(existing) : null;
    const wasRevoked = !!existing?.revokedAt;

    const row = existing ?? this.storeRepo.create({ employeeId: targetEmployeeId, storeId });
    if (dto.accessRole !== undefined) row.accessRole = dto.accessRole;
    for (const k of ['canViewDashboard', 'canViewFinancials', 'canViewEmployees', 'canViewAlerts', 'canCompare'] as const) {
      if (dto[k] !== undefined) (row as any)[k] = dto[k];
    }
    // Présent (string OU null) ⇒ appliquer (null efface la borne) ; absent (undefined) ⇒ conserver.
    if (dto.validFrom !== undefined) row.validFrom = dto.validFrom ? new Date(dto.validFrom) : null;
    if (dto.validUntil !== undefined) row.validUntil = dto.validUntil ? new Date(dto.validUntil) : null;
    row.grantedBy = actor.actorEmployeeId;
    row.grantedReason = dto.reason ?? row.grantedReason ?? null;
    // Re-grant d'un accès révoqué : on ré-active la ligne (soft-undelete).
    row.revokedAt = null;
    row.revokedBy = null;

    const saved = await this.storeRepo.save(row);
    const eventType = !existing || wasRevoked ? 'STORE_ADDED' : 'ACCESS_UPDATED';
    await this.audit.append({
      actorEmployeeId: actor.actorEmployeeId,
      targetEmployeeId,
      eventType,
      storeId,
      previousValue,
      newValue: snapshotStore(saved),
      reason: dto.reason ?? null,
      ipAddress: actor.ipAddress ?? null,
    });
    return saved;
  }

  async revokeStoreAccess(targetEmployeeId: string, storeId: string, reason: string | null, actor: ActorContext) {
    const row = await this.storeRepo.findOne({ where: { employeeId: targetEmployeeId, storeId } });
    if (!row || row.revokedAt) throw new NotFoundException("Aucun accès magasin actif à révoquer.");
    const previousValue = snapshotStore(row);
    row.revokedAt = new Date();
    row.revokedBy = actor.actorEmployeeId;
    const saved = await this.storeRepo.save(row);
    await this.audit.append({
      actorEmployeeId: actor.actorEmployeeId,
      targetEmployeeId,
      eventType: 'STORE_REMOVED',
      storeId,
      previousValue,
      newValue: snapshotStore(saved),
      reason,
      ipAddress: actor.ipAddress ?? null,
    });
    return saved;
  }
}

function snapshotApp(r: EmployeeApplicationAccessEntity): Record<string, unknown> {
  return {
    applicationEnabled: r.applicationEnabled,
    applicationRole: r.applicationRole,
    permissionLevel: r.permissionLevel,
    primaryStoreId: r.primaryStoreId,
    validFrom: r.validFrom ? new Date(r.validFrom).toISOString() : null,
    validUntil: r.validUntil ? new Date(r.validUntil).toISOString() : null,
    suspendedAt: r.suspendedAt ? new Date(r.suspendedAt).toISOString() : null,
  };
}

function snapshotStore(r: EmployeeStoreAccessEntity): Record<string, unknown> {
  return {
    accessRole: r.accessRole,
    canViewDashboard: r.canViewDashboard,
    canViewFinancials: r.canViewFinancials,
    canViewEmployees: r.canViewEmployees,
    canViewAlerts: r.canViewAlerts,
    canCompare: r.canCompare,
    validFrom: r.validFrom ? new Date(r.validFrom).toISOString() : null,
    validUntil: r.validUntil ? new Date(r.validUntil).toISOString() : null,
    revokedAt: r.revokedAt ? new Date(r.revokedAt).toISOString() : null,
  };
}
