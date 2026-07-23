import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { UnitEntity } from '../../database/entities/unit.entity';
import { OrganizationEntity } from '../../database/entities/organization.entity';
import { BusinessError } from '../../common/errors/business-error';
import { CreateUnitDto, UpdateUnitDto } from '../../common/dto';

@Injectable()
export class UnitsService {
  private readonly logger = new Logger(UnitsService.name);

  constructor(
    @InjectRepository(UnitEntity)
    private unitRepo: Repository<UnitEntity>,
    @InjectRepository(OrganizationEntity)
    private orgRepo: Repository<OrganizationEntity>,
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
    if (!unit) throw BusinessError.notFound('Unit', id);
    return unit;
  }

  async create(dto: CreateUnitDto): Promise<UnitEntity> {
    // Validate that organization exists and is active
    const org = await this.orgRepo.findOne({
      where: { id: dto.organizationId },
    });
    if (!org) {
      throw BusinessError.invalidRelation(
        `Organization avec l'identifiant « ${dto.organizationId} » est introuvable.`,
      );
    }
    if (!org.isActive) {
      throw BusinessError.invalidRelation(
        `Organization « ${org.name} » est désactivée.`,
      );
    }

    // Uniqueness check: same name within same organization
    const existing = await this.unitRepo.findOne({
      where: {
        name: dto.name,
        organizationId: dto.organizationId,
        isActive: true,
      },
    });
    if (existing) {
      throw BusinessError.alreadyExists('Unit', 'name', dto.name);
    }

    const unit = this.unitRepo.create(dto);
    const saved = await this.unitRepo.save(unit);
    this.logger.log(
      `Unit created: ${saved.name} (${saved.id}) in org ${saved.organizationId}`,
    );
    return saved;
  }

  async update(id: string, dto: UpdateUnitDto): Promise<UnitEntity> {
    const unit = await this.findOne(id);

    // If renaming, check uniqueness within same org
    if (dto.name && dto.name !== unit.name) {
      const orgId = dto.organizationId ?? unit.organizationId;
      const existing = await this.unitRepo.findOne({
        where: { name: dto.name, organizationId: orgId ?? IsNull(), isActive: true },
      });
      if (existing) {
        throw BusinessError.alreadyExists('Unit', 'name', dto.name);
      }
    }

    Object.assign(unit, dto);
    const saved = await this.unitRepo.save(unit);
    this.logger.log(`Unit updated: ${saved.name} (${saved.id})`);
    return saved;
  }

  async deactivate(id: string): Promise<UnitEntity> {
    const unit = await this.findOne(id);
    unit.isActive = false;
    const saved = await this.unitRepo.save(unit);
    this.logger.log(`Unit deactivated: ${saved.name} (${saved.id})`);
    return saved;
  }
}
