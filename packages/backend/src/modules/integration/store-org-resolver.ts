import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { StoreEntity } from '../../database/entities/store.entity';

/**
 * Resolves a store's organizationId for integration-event enrichment (TD-INT-ORG).
 * In-memory cached (org rarely changes) so it adds at most one indexed PK read
 * per store per process — never a burden on the caisse path.
 */
@Injectable()
export class StoreOrgResolver {
  private readonly cache = new Map<string, string | null>();

  constructor(
    @InjectRepository(StoreEntity)
    private readonly stores: Repository<StoreEntity>,
  ) {}

  async resolve(storeId: string): Promise<string | null> {
    if (this.cache.has(storeId)) return this.cache.get(storeId) ?? null;
    const store = await this.stores.findOne({
      where: { id: storeId },
      select: ['id', 'organizationId'],
    });
    const org = store?.organizationId ?? null;
    this.cache.set(storeId, org);
    return org;
  }

  /** Test/ops hook — drop a cached entry (e.g. after a store re-org). */
  invalidate(storeId: string): void {
    this.cache.delete(storeId);
  }
}
