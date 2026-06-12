import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { StoreEntity } from '../../database/entities/store.entity';
import { EmployeeStoreAccessEntity } from '../../database/entities/employee-store-access.entity';

export interface ScopePrincipal {
  employeeId: string;
  storeId: string; // home store carried by the (single-store) JWT
  role: string;
}

/**
 * INV-5 — resolves the SET of stores a cockpit principal may see. The cockpit/jobs
 * then filter every read with `applyStoreScope` (WHERE store_id IN scope) at the
 * QUERY layer. This is the ONLY place the owner/manager → stores mapping lives.
 *
 * Mapping (decision 3, frozen):
 *   - org-wide roles → the principal's WHOLE organization (every active store of
 *     their org). The cockpit term is "owner"; this backend's existing org-wide role
 *     is "admin", so both are treated as org-wide (forward-compatible, not hard-coded
 *     to one value). [Role-enum nuance flagged: no literal 'owner' role exists yet.]
 *   - "manager" → their explicit stores in `employee_store_access` (∪ home store).
 *   - anything else (e.g. cashier) → their own store only (fail-closed minimal scope).
 *
 * Fail-closed everywhere: an org-less / accessless principal collapses to [home store],
 * never to "all stores".
 */
@Injectable()
export class StoreScopeResolverService {
  private static readonly ORG_WIDE_ROLES = ['owner', 'admin'];

  constructor(
    @InjectRepository(StoreEntity)
    private readonly stores: Repository<StoreEntity>,
    @InjectRepository(EmployeeStoreAccessEntity)
    private readonly access: Repository<EmployeeStoreAccessEntity>,
  ) {}

  async resolveAccessibleStoreIds(p: ScopePrincipal): Promise<string[]> {
    const role = (p.role || '').toLowerCase();

    if (StoreScopeResolverService.ORG_WIDE_ROLES.includes(role)) {
      const home = await this.stores.findOne({ where: { id: p.storeId } });
      const org = home?.organizationId ?? null;
      if (!org) return uniq([p.storeId]); // org-less → own store only (fail-closed)
      const rows = await this.stores.find({
        where: { organizationId: org, isActive: true },
        select: ['id'],
      });
      const ids = rows.map((r) => r.id);
      return uniq(ids.length ? ids : [p.storeId]);
    }

    if (role === 'manager') {
      const rows = await this.access.find({
        where: { employeeId: p.employeeId },
        select: ['storeId'],
      });
      return uniq([p.storeId, ...rows.map((r) => r.storeId)]);
    }

    // cashier / unknown → own store only
    return uniq([p.storeId]);
  }
}

const uniq = (a: (string | null | undefined)[]): string[] =>
  Array.from(new Set(a.filter((x): x is string => !!x)));
