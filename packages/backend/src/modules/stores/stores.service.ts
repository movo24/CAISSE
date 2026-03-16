import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { StoreEntity } from '../../database/entities/store.entity';
import { OrganizationEntity } from '../../database/entities/organization.entity';
import { UnitEntity } from '../../database/entities/unit.entity';
import { BusinessError } from '../../common/errors/business-error';
import { CreateStoreDto } from '../../common/dto';
import { mapStoreEntityToStoreInfo } from './store-info.mapper';
import { generateUniqueStoreCode } from '../../common/utils/store-code-generator';

@Injectable()
export class StoresService {
  private readonly logger = new Logger(StoresService.name);

  constructor(
    @InjectRepository(StoreEntity)
    private storeRepo: Repository<StoreEntity>,
    @InjectRepository(OrganizationEntity)
    private orgRepo: Repository<OrganizationEntity>,
    @InjectRepository(UnitEntity)
    private unitRepo: Repository<UnitEntity>,
  ) {}

  async create(dto: CreateStoreDto): Promise<StoreEntity> {
    // ── 1. Auto-generate store_code if not provided ──
    if (!dto.storeCode) {
      dto.storeCode = await generateUniqueStoreCode(
        dto.name,
        dto.city,
        async (code) => {
          const found = await this.storeRepo.findOne({
            where: { storeCode: code },
          });
          return !!found;
        },
      );
      this.logger.log(`Auto-generated store code: ${dto.storeCode}`);
    } else {
      // ── 2. Validate storeCode uniqueness if manually provided ──
      const existing = await this.storeRepo.findOne({
        where: { storeCode: dto.storeCode },
      });
      if (existing) {
        throw BusinessError.alreadyExists('Store', 'storeCode', dto.storeCode);
      }
    }

    // ── 3. Validate organization exists if provided ──
    if (dto.organizationId) {
      const org = await this.orgRepo.findOne({
        where: { id: dto.organizationId },
      });
      if (!org) {
        throw BusinessError.invalidRelation(
          `Organization avec l'identifiant « ${dto.organizationId} » est introuvable.`,
        );
      }
    }

    // ── 4. Validate unit exists and belongs to same org if provided ──
    if (dto.unitId) {
      const unit = await this.unitRepo.findOne({
        where: { id: dto.unitId },
      });
      if (!unit) {
        throw BusinessError.invalidRelation(
          `Unit avec l'identifiant « ${dto.unitId} » est introuvable.`,
        );
      }
      if (
        dto.organizationId &&
        unit.organizationId !== dto.organizationId
      ) {
        throw BusinessError.invalidRelation(
          `Unit « ${unit.name} » n'appartient pas à l'organisation spécifiée.`,
        );
      }
    }

    const store = this.storeRepo.create(dto);
    const saved = await this.storeRepo.save(store);
    this.logger.log(
      `Store created: ${saved.name} [${saved.storeCode}] (${saved.id})`,
    );
    return saved;
  }

  /** List all stores, optionally filtered by organization or unit */
  async findAll(filters?: {
    organizationId?: string;
    unitId?: string;
  }): Promise<StoreEntity[]> {
    const where: any = {};
    if (filters?.organizationId)
      where.organizationId = filters.organizationId;
    if (filters?.unitId) where.unitId = filters.unitId;
    return this.storeRepo.find({
      where,
      order: { name: 'ASC' },
      relations: ['organization', 'unit'],
    });
  }

  /** Returns only the user's own store (tenant-scoped) */
  async findMyStore(storeId: string): Promise<StoreEntity> {
    const store = await this.storeRepo.findOne({
      where: { id: storeId, isActive: true },
    });
    if (!store) throw BusinessError.notFound('Store', storeId);
    return store;
  }

  async findOne(id: string): Promise<StoreEntity> {
    const store = await this.storeRepo.findOne({ where: { id } });
    if (!store) throw BusinessError.notFound('Store', id);
    return store;
  }

  /** Returns store info formatted for POS frontend (StoreInfo shape) */
  async getStoreInfo(storeId: string) {
    const store = await this.findMyStore(storeId);
    return mapStoreEntityToStoreInfo(store);
  }

  async update(
    id: string,
    data: Partial<StoreEntity>,
    callerStoreId: string,
  ): Promise<StoreEntity> {
    // Only allow updating your own store
    if (id !== callerStoreId) {
      throw BusinessError.forbidden(
        'Access denied: you cannot modify another store.',
      );
    }
    await this.findOne(id);
    await this.storeRepo.update(id, data);
    return this.findOne(id);
  }

  async archive(id: string): Promise<StoreEntity> {
    const store = await this.findOne(id);
    store.isArchived = true;
    store.isActive = false;
    const saved = await this.storeRepo.save(store);
    this.logger.log(`Store archived: ${saved.name} (${saved.id})`);
    return saved;
  }

  async activate(id: string): Promise<StoreEntity> {
    const store = await this.findOne(id);
    // An archived store cannot be activated — must be unarchived first
    if (store.isArchived) {
      throw BusinessError.archived('Store');
    }
    store.isActive = true;
    const saved = await this.storeRepo.save(store);
    this.logger.log(`Store activated: ${saved.name} (${saved.id})`);
    return saved;
  }

  async deactivate(id: string): Promise<StoreEntity> {
    const store = await this.findOne(id);
    store.isActive = false;
    const saved = await this.storeRepo.save(store);
    this.logger.log(`Store deactivated: ${saved.name} (${saved.id})`);
    return saved;
  }
}
