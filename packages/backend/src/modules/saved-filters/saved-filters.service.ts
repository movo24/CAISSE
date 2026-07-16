import { Injectable, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UserSavedFilterEntity } from '../../database/entities/user-saved-filter.entity';

/**
 * Vues/filtres enregistrables par employé (P-D / M-G). Persistance serveur du
 * stockage localStorage (Lot J). `config` est opaque (non interprété serveur).
 */
@Injectable()
export class SavedFiltersService {
  constructor(
    @InjectRepository(UserSavedFilterEntity)
    private readonly repo: Repository<UserSavedFilterEntity>,
  ) {}

  list(employeeId: string, page: string): Promise<UserSavedFilterEntity[]> {
    return this.repo.find({ where: { employeeId, page: page || 'default' }, order: { name: 'ASC' } });
  }

  async upsert(
    employeeId: string,
    page: string,
    name: string,
    config: Record<string, unknown>,
  ): Promise<UserSavedFilterEntity> {
    const cleanName = (name || '').trim();
    if (!cleanName) throw new BadRequestException('Le nom de la vue est requis');
    const cleanPage = (page || '').trim() || 'default';
    const existing = await this.repo.findOne({ where: { employeeId, page: cleanPage, name: cleanName } });
    if (existing) {
      existing.config = config ?? {};
      return this.repo.save(existing);
    }
    return this.repo.save(this.repo.create({ employeeId, page: cleanPage, name: cleanName, config: config ?? {} }));
  }

  async remove(employeeId: string, id: string): Promise<{ deleted: boolean }> {
    const res = await this.repo.delete({ id, employeeId });
    return { deleted: (res.affected ?? 0) > 0 };
  }
}
