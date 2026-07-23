import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { EmployeeEntity } from '../../database/entities/employee.entity';
import { EmployeeApplicationAccessEntity } from '../../database/entities/employee-application-access.entity';
import { EmployeeStoreAccessEntity } from '../../database/entities/employee-store-access.entity';
import { AccessDenyReason, StorePermission, isGlobalScopeRole } from './application-access.constants';

export interface EffectiveAccess {
  allowed: boolean;
  reason?: AccessDenyReason;
  applicationRole?: string;
  globalScope: boolean;
}

export interface AccessQuery {
  employeeId: string;
  storeId?: string;
  permission?: StorePermission;
  /** Fourni par le guard depuis req.user (déjà re-vérifié actif). Sinon chargé en base. */
  accountActive?: boolean;
  /** Instant d'évaluation (déterminisme des tests). Défaut = maintenant. */
  at?: Date;
}

/** `can_view_financials` → propriété d'entité `canViewFinancials`. */
const PERMISSION_TO_PROP: Record<StorePermission, keyof EmployeeStoreAccessEntity> = {
  can_view_dashboard: 'canViewDashboard',
  can_view_financials: 'canViewFinancials',
  can_view_employees: 'canViewEmployees',
  can_view_alerts: 'canViewAlerts',
  can_compare: 'canCompare',
};

function withinWindow(now: Date, from: Date | null, until: Date | null): boolean {
  // Normalise: le driver peut renvoyer Date ou string selon l'environnement.
  if (from && now < new Date(from as unknown as string)) return false;
  if (until && now > new Date(until as unknown as string)) return false;
  return true;
}

/**
 * Résolveur d'accès effectif — la SEULE source de vérité serveur pour le pilotage.
 *
 * Règle : compte actif · accès application actif · non suspendu · période valide ·
 *          magasin dans le périmètre · permission accordée.
 * Les rôles centraux et technique ont un périmètre global (bypass magasin).
 */
@Injectable()
export class AccessService {
  constructor(
    @InjectRepository(EmployeeApplicationAccessEntity)
    private readonly appAccessRepo: Repository<EmployeeApplicationAccessEntity>,
    @InjectRepository(EmployeeStoreAccessEntity)
    private readonly storeAccessRepo: Repository<EmployeeStoreAccessEntity>,
    @InjectRepository(EmployeeEntity)
    private readonly employeeRepo: Repository<EmployeeEntity>,
  ) {}

  async resolveEffectiveAccess(q: AccessQuery): Promise<EffectiveAccess> {
    const now = q.at ?? new Date();

    // 1. Compte actif
    let accountActive = q.accountActive;
    if (accountActive === undefined) {
      const emp = await this.employeeRepo.findOne({ where: { id: q.employeeId } });
      accountActive = !!emp?.isActive;
    }
    if (!accountActive) return { allowed: false, reason: 'ACCOUNT_INACTIVE', globalScope: false };

    // 2. Accès application actif
    const app = await this.appAccessRepo.findOne({ where: { employeeId: q.employeeId } });
    if (!app || !app.applicationEnabled) {
      return { allowed: false, reason: 'NO_APPLICATION_ACCESS', globalScope: false };
    }

    // 3. Suspension immédiate
    if (app.suspendedAt) {
      return { allowed: false, reason: 'ACCOUNT_SUSPENDED', applicationRole: app.applicationRole, globalScope: false };
    }

    // 4. Validité de l'accès application
    if (!withinWindow(now, app.validFrom, app.validUntil)) {
      return { allowed: false, reason: 'ACCESS_EXPIRED', applicationRole: app.applicationRole, globalScope: false };
    }

    const globalScope = isGlobalScopeRole(app.applicationRole);

    // 5. Périmètre magasin + permission (sauf rôles globaux)
    if (q.storeId && !globalScope) {
      const grant = await this.storeAccessRepo.findOne({
        where: { employeeId: q.employeeId, storeId: q.storeId },
      });
      if (!grant || grant.revokedAt) {
        return { allowed: false, reason: 'STORE_NOT_IN_SCOPE', applicationRole: app.applicationRole, globalScope };
      }
      if (!withinWindow(now, grant.validFrom, grant.validUntil)) {
        return { allowed: false, reason: 'ACCESS_EXPIRED', applicationRole: app.applicationRole, globalScope };
      }
      if (q.permission && grant[PERMISSION_TO_PROP[q.permission]] !== true) {
        return { allowed: false, reason: 'PERMISSION_DENIED', applicationRole: app.applicationRole, globalScope };
      }
    }

    return { allowed: true, applicationRole: app.applicationRole, globalScope };
  }

  /**
   * Périmètre magasin autorisé d'un employé. `global:true` = tous magasins (rôle central).
   * Utilisé pour scoper les listes côté serveur : le frontend ne reçoit JAMAIS un magasin
   * hors périmètre.
   */
  async listAccessibleStores(
    employeeId: string,
    at: Date = new Date(),
  ): Promise<{ global: boolean; storeIds: string[] }> {
    const app = await this.appAccessRepo.findOne({ where: { employeeId } });
    if (!app || !app.applicationEnabled || app.suspendedAt || !withinWindow(at, app.validFrom, app.validUntil)) {
      return { global: false, storeIds: [] };
    }
    if (isGlobalScopeRole(app.applicationRole)) return { global: true, storeIds: [] };
    const grants = await this.storeAccessRepo.find({ where: { employeeId } });
    const storeIds = grants
      .filter((g) => !g.revokedAt && withinWindow(at, g.validFrom, g.validUntil))
      .map((g) => g.storeId);
    return { global: false, storeIds };
  }
}
