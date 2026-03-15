import {
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { StoreEntity } from '../../database/entities/store.entity';
import { mapStoreEntityToStoreInfo } from './store-info.mapper';

@Injectable()
export class StoresService {
  constructor(
    @InjectRepository(StoreEntity)
    private storeRepo: Repository<StoreEntity>,
  ) {}

  async create(data: Partial<StoreEntity>): Promise<StoreEntity> {
    const store = this.storeRepo.create(data);
    return this.storeRepo.save(store);
  }

  /** Returns only the user's own store (tenant-scoped) */
  async findMyStore(storeId: string): Promise<StoreEntity> {
    const store = await this.storeRepo.findOne({
      where: { id: storeId, isActive: true },
    });
    if (!store) throw new NotFoundException('Store not found');
    return store;
  }

  async findOne(id: string): Promise<StoreEntity> {
    const store = await this.storeRepo.findOne({ where: { id } });
    if (!store) throw new NotFoundException('Store not found');
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
      throw new ForbiddenException(
        'Access denied: you cannot modify another store.',
      );
    }
    await this.findOne(id);
    await this.storeRepo.update(id, data);
    return this.findOne(id);
  }
}
