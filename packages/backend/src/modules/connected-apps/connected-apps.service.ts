import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConnectedAppEntity } from '../../database/entities/connected-app.entity';
import { OrganizationEntity } from '../../database/entities/organization.entity';
import { BusinessError } from '../../common/errors/business-error';
import {
  CreateConnectedAppDto,
  UpdateConnectedAppDto,
} from '../../common/dto';

@Injectable()
export class ConnectedAppsService {
  private readonly logger = new Logger(ConnectedAppsService.name);

  constructor(
    @InjectRepository(ConnectedAppEntity)
    private appRepo: Repository<ConnectedAppEntity>,
    @InjectRepository(OrganizationEntity)
    private orgRepo: Repository<OrganizationEntity>,
  ) {}

  async findAll(organizationId: string): Promise<ConnectedAppEntity[]> {
    return this.appRepo.find({
      where: { organizationId, isActive: true },
      order: { name: 'ASC' },
    });
  }

  async findOne(id: string): Promise<ConnectedAppEntity> {
    const app = await this.appRepo.findOne({ where: { id } });
    if (!app) throw BusinessError.notFound('ConnectedApp', id);
    return app;
  }

  async create(dto: CreateConnectedAppDto): Promise<ConnectedAppEntity> {
    // Validate that organization exists
    const org = await this.orgRepo.findOne({
      where: { id: dto.organizationId },
    });
    if (!org) {
      throw BusinessError.invalidRelation(
        `Organization avec l'identifiant « ${dto.organizationId} » est introuvable.`,
      );
    }

    const app = this.appRepo.create(dto);
    const saved = await this.appRepo.save(app);
    this.logger.log(`Connected app created: ${saved.name} (${saved.id})`);
    return saved;
  }

  async update(
    id: string,
    dto: UpdateConnectedAppDto,
  ): Promise<ConnectedAppEntity> {
    const app = await this.findOne(id);

    // If changing organization, validate it exists
    if (dto.organizationId && dto.organizationId !== app.organizationId) {
      const org = await this.orgRepo.findOne({
        where: { id: dto.organizationId },
      });
      if (!org) {
        throw BusinessError.invalidRelation(
          `Organization avec l'identifiant « ${dto.organizationId} » est introuvable.`,
        );
      }
    }

    Object.assign(app, dto);
    const saved = await this.appRepo.save(app);
    this.logger.log(`Connected app updated: ${saved.name} (${saved.id})`);
    return saved;
  }

  async deactivate(id: string): Promise<ConnectedAppEntity> {
    const app = await this.findOne(id);
    app.isActive = false;
    const saved = await this.appRepo.save(app);
    this.logger.log(`Connected app deactivated: ${saved.name} (${saved.id})`);
    return saved;
  }
}
