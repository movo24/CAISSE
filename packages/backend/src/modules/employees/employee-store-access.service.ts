import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { EmployeeStoreAccessEntity } from '../../database/entities/employee-store-access.entity';
import { EmployeeEntity } from '../../database/entities/employee.entity';
import { StoreEntity } from '../../database/entities/store.entity';
import { AuditService } from '../audit/audit.service';

/**
 * Role CONTROL-PLANE (governance commit 2) — owner-only provisioning/revoking of
 * a manager's cross-store access. INV-5 (store-scope-resolver) already ENFORCES
 * which stores a manager sees by reading employee_store_access; this is the
 * missing surface that MANAGES those rows.
 *
 * Every grant/revoke is written ATOMICALLY with a chained audit entry on the
 * STORE's chain (runWithAudit) — a change to "who sees this store" can never
 * happen without an attributable, chained record. Owner-only is enforced at the
 * controller (@Roles('admin') = org_admin), consistent with hours = owner-only.
 *
 * Note: employee_store_access.role is NOT consumed by the scope resolver (it
 * reads rows by employeeId only), so this surface does NOT expose a role
 * parameter — the row's existence IS the grant. No field-without-effect.
 */
@Injectable()
export class EmployeeStoreAccessService {
  constructor(
    @InjectRepository(EmployeeStoreAccessEntity)
    private readonly access: Repository<EmployeeStoreAccessEntity>,
    @InjectRepository(EmployeeEntity)
    private readonly employees: Repository<EmployeeEntity>,
    @InjectRepository(StoreEntity)
    private readonly stores: Repository<StoreEntity>,
    private readonly audit: AuditService,
  ) {}

  /** The stores a manager has been explicitly granted (excludes their home store). */
  async list(employeeId: string): Promise<Array<{ storeId: string; grantedAt: Date }>> {
    const rows = await this.access.find({ where: { employeeId }, order: { createdAt: 'ASC' } });
    return rows.map((r) => ({ storeId: r.storeId, grantedAt: r.createdAt }));
  }

  /** Grant access (idempotent), atomic with a chained audit entry on the store. */
  async grant(employeeId: string, storeId: string, actorEmployeeId: string): Promise<void> {
    await this.assertExists(employeeId, storeId);
    await this.audit.runWithAudit(
      {
        storeId,
        employeeId: actorEmployeeId,
        action: 'store_access_granted',
        entityType: 'employee_store_access',
        entityId: employeeId,
        details: { grantedEmployeeId: employeeId, storeId },
      },
      async (m) => {
        const repo = m.getRepository(EmployeeStoreAccessEntity);
        // Check-then-insert under the per-store lock runWithAudit holds: race-free
        // in-process (a caught 23505 would abort the surrounding PG transaction),
        // the unique index is the structural backstop.
        const existing = await repo.findOne({ where: { employeeId, storeId } });
        if (!existing) {
          await repo.insert({ employeeId, storeId });
        }
      },
    );
  }

  /** Revoke access (idempotent), atomic with a chained audit entry on the store. */
  async revoke(employeeId: string, storeId: string, actorEmployeeId: string): Promise<void> {
    await this.assertExists(employeeId, storeId);
    await this.audit.runWithAudit(
      {
        storeId,
        employeeId: actorEmployeeId,
        action: 'store_access_revoked',
        entityType: 'employee_store_access',
        entityId: employeeId,
        details: { revokedEmployeeId: employeeId, storeId },
      },
      async (m) => {
        await m.getRepository(EmployeeStoreAccessEntity).delete({ employeeId, storeId });
      },
    );
  }

  private async assertExists(employeeId: string, storeId: string): Promise<void> {
    if (!(await this.employees.findOne({ where: { id: employeeId } }))) {
      throw new NotFoundException(`Employé introuvable: ${employeeId}`);
    }
    if (!(await this.stores.findOne({ where: { id: storeId } }))) {
      throw new NotFoundException(`Magasin introuvable: ${storeId}`);
    }
  }
}
