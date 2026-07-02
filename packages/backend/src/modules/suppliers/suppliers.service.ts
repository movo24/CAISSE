import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SupplierEntity } from '../../database/entities/supplier.entity';

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
  ) {}

  async create(storeId: string, data: { name: string; contact?: string; notes?: string }): Promise<SupplierEntity> {
    const name = data.name.trim();
    const existing = await this.repo.findOne({ where: { storeId, name } });
    if (existing) {
      throw new ConflictException(`Un fournisseur « ${name} » existe déjà dans ce magasin.`);
    }
    return this.repo.save(
      this.repo.create({ storeId, name, contact: data.contact ?? null, notes: data.notes ?? null }),
    );
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
  ): Promise<SupplierEntity> {
    const s = await this.findOne(id, storeId);
    if (data.name && data.name.trim() !== s.name) {
      const clash = await this.repo.findOne({ where: { storeId, name: data.name.trim() } });
      if (clash) throw new ConflictException(`Un fournisseur « ${data.name.trim()} » existe déjà.`);
      s.name = data.name.trim();
    }
    if (data.contact !== undefined) s.contact = data.contact;
    if (data.notes !== undefined) s.notes = data.notes;
    if (data.isActive !== undefined) s.isActive = data.isActive;
    return this.repo.save(s);
  }

  /** Soft-delete : les produits référencent toujours l'id (historique intact). */
  async deactivate(id: string, storeId: string): Promise<{ message: string }> {
    const s = await this.findOne(id, storeId);
    s.isActive = false;
    await this.repo.save(s);
    return { message: `Fournisseur « ${s.name} » désactivé.` };
  }
}
