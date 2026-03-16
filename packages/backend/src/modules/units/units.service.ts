import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UnitEntity } from '../../database/entities/unit.entity';

@Injectable()
export class UnitsService {
  private readonly logger = new Logger(UnitsService.name);

  constructor(
    @InjectRepository(UnitEntity)
    private unitRepo: Repository<UnitEntity>,
  ) {}

  async findAll(organizationId?: string): Promise<UnitEntity[]> {
    const where: any = { isActive: true };
    if (organizationId) where.organizationId = organizationId;
    return this.unitRepo.find({
      where,
      order: { name: 'ASC' },
      relations: ['stores'],
    });
  }

  async findOne(id: string): Promise<UnitEntity> {
    const unit = await this.unitRepo.findOne({
      where: { id },
      relations: ['stores', 'organization'],
    });
    if (!unit) throw new NotFoundException('Unit not found');
    return unit;
  }

  async create(data: Partial<UnitEntity>): Promise<UnitEntity> {
    const unit = this.unitRepo.create(data);
    const saved = await this.unitRepo.save(unit);
    this.logger.log(`Unit created: ${saved.name} (${saved.id}) in org ${saved.organizationId}`);
    return saved;
  }

  async update(id: string, data: Partial<UnitEntity>): Promise<UnitEntity> {
    const unit = await this.findOne(id);
    Object.assign(unit, data);
    const saved = await this.unitRepo.save(unit);
    this.logger.log(`Unit updated: ${saved.name} (${saved.id})`);
    return saved;
  }

  async deactivate(id: string): Promise<UnitEntity> {
    return this.update(id, { isActive: false });
  }
}
