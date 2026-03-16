import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConnectedAppEntity } from '../../database/entities/connected-app.entity';

@Injectable()
export class ConnectedAppsService {
  private readonly logger = new Logger(ConnectedAppsService.name);

  constructor(
    @InjectRepository(ConnectedAppEntity)
    private appRepo: Repository<ConnectedAppEntity>,
  ) {}

  async findAll(organizationId: string): Promise<ConnectedAppEntity[]> {
    return this.appRepo.find({
      where: { organizationId, isActive: true },
      order: { name: 'ASC' },
    });
  }

  async findOne(id: string): Promise<ConnectedAppEntity> {
    const app = await this.appRepo.findOne({ where: { id } });
    if (!app) throw new NotFoundException('Connected app not found');
    return app;
  }

  async create(data: Partial<ConnectedAppEntity>): Promise<ConnectedAppEntity> {
    const app = this.appRepo.create(data);
    const saved = await this.appRepo.save(app);
    this.logger.log(`Connected app created: ${saved.name} (${saved.id})`);
    return saved;
  }

  async update(id: string, data: Partial<ConnectedAppEntity>): Promise<ConnectedAppEntity> {
    const app = await this.findOne(id);
    Object.assign(app, data);
    const saved = await this.appRepo.save(app);
    this.logger.log(`Connected app updated: ${saved.name} (${saved.id})`);
    return saved;
  }

  async deactivate(id: string): Promise<ConnectedAppEntity> {
    return this.update(id, { isActive: false });
  }
}
