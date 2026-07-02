import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SupplierEntity } from '../../database/entities/supplier.entity';
import { AuditService } from '../audit/audit.service';

/**
 * P327 (cycle K — variantes option A) — référentiel fournisseur minimal,
 * tenant-scoped. Le nom est unique PAR MAGASIN (index DB en dernier rempart,
 * vérif applicative pour un message clair). Suppression = désactivation
 * (les produits gardent leur supplier_id — pas de perte d'historique).
 */
@Injectable()
export class SuppliersService {
  constructor(
    @InjectRepository(SupplierEntity)
    private readonly repo: Repository<SupplierEntity>,
    private readonly auditService: AuditService,
  ) {}

  /** Cycle Q — mutation référentiel = tracée (append-only), jamais bloquante. */
  private async audit(
    storeId: string,
    employeeId: string | undefined,
    action: 'supplier_created' | 'supplier_updated' | 'supplier_deactivated',
    entityId: string,
    details: Record<string, unknown>,
  ): Promise<void> {
    try {
      await this.auditService.log({
        storeId,
        employeeId: employeeId ?? 'unknown',
        action,
        entityType: 'supplier',
        entityId,
        details,
      });
    } catch (e: any) {
      // L'audit ne doit jamais faire échouer la mutation métier déjà validée.
      console.warn(`[SuppliersService] audit ${action} failed (non-blocking): ${e?.message}`);
    }
  }

  async create(
    storeId: string,
    data: { name: string; contact?: string; notes?: string },
    employeeId?: string,
  ): Promise<SupplierEntity> {
    const name = data.name.trim();
    const existing = await this.repo.findOne({ where: { storeId, name } });
    if (existing) {
      throw new ConflictException(`Un fournisseur « ${name} » existe déjà dans ce magasin.`);
    }
    const saved = await this.repo.save(
      this.repo.create({ storeId, name, contact: data.contact ?? null, notes: data.notes ?? null }),
    );
    await this.audit(storeId, employeeId, 'supplier_created', saved.id, { name });
    return saved;
  }

  async list(storeId: string, includeInactive = false): Promise<SupplierEntity[]> {
    return this.repo.find({
      where: includeInactive ? { storeId } : { storeId, isActive: true },
      order: { name: 'ASC' },
    });
  }

  async findOne(id: string, storeId: string): Promise<SupplierEntity> {
    const s = await this.repo.findOne({ where: { id, storeId } });
    if (!s) throw new NotFoundException('Fournisseur introuvable');
    return s;
  }

  async update(
    id: string,
    storeId: string,
    data: { name?: string; contact?: string | null; notes?: string | null; isActive?: boolean },
    employeeId?: string,
  ): Promise<SupplierEntity> {
    const s = await this.findOne(id, storeId);
    const before = { name: s.name, contact: s.contact, notes: s.notes, isActive: s.isActive };
    if (data.name && data.name.trim() !== s.name) {
      const clash = await this.repo.findOne({ where: { storeId, name: data.name.trim() } });
      if (clash) throw new ConflictException(`Un fournisseur « ${data.name.trim()} » existe déjà.`);
      s.name = data.name.trim();
    }
    if (data.contact !== undefined) s.contact = data.contact;
    if (data.notes !== undefined) s.notes = data.notes;
    if (data.isActive !== undefined) s.isActive = data.isActive;
    const saved = await this.repo.save(s);
    await this.audit(storeId, employeeId, 'supplier_updated', id, {
      before,
      after: { name: saved.name, contact: saved.contact, notes: saved.notes, isActive: saved.isActive },
    });
    return saved;
  }

  /** Soft-delete : les produits référencent toujours l'id (historique intact). */
  async deactivate(id: string, storeId: string, employeeId?: string): Promise<{ message: string }> {
    const s = await this.findOne(id, storeId);
    s.isActive = false;
    await this.repo.save(s);
    await this.audit(storeId, employeeId, 'supplier_deactivated', id, { name: s.name });
    return { message: `Fournisseur « ${s.name} » désactivé.` };
  }
}
