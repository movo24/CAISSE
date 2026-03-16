import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { OrganizationEntity } from '../../database/entities/organization.entity';
import { UnitEntity } from '../../database/entities/unit.entity';
import { StoreEntity } from '../../database/entities/store.entity';
import { BusinessError } from '../../common/errors/business-error';
import {
  CreateOrganizationDto,
  UpdateOrganizationDto,
} from '../../common/dto';

@Injectable()
export class OrganizationsService {
  private readonly logger = new Logger(OrganizationsService.name);

  constructor(
    @InjectRepository(OrganizationEntity)
    private orgRepo: Repository<OrganizationEntity>,
    @InjectRepository(UnitEntity)
    private unitRepo: Repository<UnitEntity>,
    @InjectRepository(StoreEntity)
    private storeRepo: Repository<StoreEntity>,
  ) {}

  async findAll(): Promise<OrganizationEntity[]> {
    return this.orgRepo.find({
      where: { isActive: true },
      order: { name: 'ASC' },
      relations: ['units', 'stores'],
    });
  }

  async findOne(id: string): Promise<OrganizationEntity> {
    const org = await this.orgRepo.findOne({
      where: { id },
      relations: ['units', 'stores'],
    });
    if (!org) throw BusinessError.notFound('Organization', id);
    return org;
  }

  async create(dto: CreateOrganizationDto): Promise<OrganizationEntity> {
    // Uniqueness check: no active org with the same name
    const existing = await this.orgRepo.findOne({
      where: { name: dto.name, isActive: true },
    });
    if (existing) {
      throw BusinessError.alreadyExists('Organization', 'name', dto.name);
    }

    const org = this.orgRepo.create(dto);
    const saved = await this.orgRepo.save(org);
    this.logger.log(`Organization created: ${saved.name} (${saved.id})`);
    return saved;
  }

  async update(
    id: string,
    dto: UpdateOrganizationDto,
  ): Promise<OrganizationEntity> {
    const org = await this.findOne(id);

    // If renaming, check uniqueness among other active orgs
    if (dto.name && dto.name !== org.name) {
      const existing = await this.orgRepo.findOne({
        where: { name: dto.name, isActive: true },
      });
      if (existing) {
        throw BusinessError.alreadyExists('Organization', 'name', dto.name);
      }
    }

    Object.assign(org, dto);
    const saved = await this.orgRepo.save(org);
    this.logger.log(`Organization updated: ${saved.name} (${saved.id})`);
    return saved;
  }

  async deactivate(id: string): Promise<OrganizationEntity> {
    const org = await this.findOne(id);
    org.isActive = false;
    const saved = await this.orgRepo.save(org);

    // Cascade deactivation: deactivate all child units
    await this.unitRepo.update(
      { organizationId: id, isActive: true },
      { isActive: false },
    );

    // Cascade deactivation: deactivate all stores belonging to this org
    await this.storeRepo.update(
      { organizationId: id, isActive: true },
      { isActive: false },
    );

    this.logger.log(
      `Organization deactivated (with cascade): ${saved.name} (${saved.id})`,
    );
    return saved;
  }
}
