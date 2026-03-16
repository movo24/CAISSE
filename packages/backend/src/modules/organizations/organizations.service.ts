import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { OrganizationEntity } from '../../database/entities/organization.entity';

@Injectable()
export class OrganizationsService {
  private readonly logger = new Logger(OrganizationsService.name);

  constructor(
    @InjectRepository(OrganizationEntity)
    private orgRepo: Repository<OrganizationEntity>,
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
    if (!org) throw new NotFoundException('Organization not found');
    return org;
  }

  async create(data: Partial<OrganizationEntity>): Promise<OrganizationEntity> {
    const org = this.orgRepo.create(data);
    const saved = await this.orgRepo.save(org);
    this.logger.log(`Organization created: ${saved.name} (${saved.id})`);
    return saved;
  }

  async update(id: string, data: Partial<OrganizationEntity>): Promise<OrganizationEntity> {
    const org = await this.findOne(id);
    Object.assign(org, data);
    const saved = await this.orgRepo.save(org);
    this.logger.log(`Organization updated: ${saved.name} (${saved.id})`);
    return saved;
  }

  async deactivate(id: string): Promise<OrganizationEntity> {
    return this.update(id, { isActive: false });
  }
}
