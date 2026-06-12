import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AnalyticsStoreRegistryEntity } from '../../database/entities/analytics-store-registry.entity';
import { AnalyticsStoreDailyEntity } from '../../database/entities/analytics-store-daily.entity';
import { AnalyticsStoreSessionsEntity } from '../../database/entities/analytics-store-sessions.entity';
import { AnalyticsStorePresenceEntity } from '../../database/entities/analytics-store-presence.entity';
import { AnalyticsStoreStockEntity } from '../../database/entities/analytics-store-stock.entity';
import { applyStoreScope } from '../analytics-projection/store-scope.util';

/**
 * Étage 1 read service — reads ONLY `analytics.*` (never the source tables). Every
 * query is scoped at the QUERY layer via applyStoreScope (INV-5); `computed_at`
 * (freshness) is carried through on every payload.
 */
@Injectable()
export class MobileReadService {
  constructor(
    @InjectRepository(AnalyticsStoreRegistryEntity) private readonly registry: Repository<AnalyticsStoreRegistryEntity>,
    @InjectRepository(AnalyticsStoreDailyEntity) private readonly daily: Repository<AnalyticsStoreDailyEntity>,
    @InjectRepository(AnalyticsStoreSessionsEntity) private readonly sessions: Repository<AnalyticsStoreSessionsEntity>,
    @InjectRepository(AnalyticsStorePresenceEntity) private readonly presence: Repository<AnalyticsStorePresenceEntity>,
    @InjectRepository(AnalyticsStoreStockEntity) private readonly stock: Repository<AnalyticsStoreStockEntity>,
  ) {}

  /** GET /stores — the authorized stores (collection, silently scoped). */
  async listStores(scope: string[]): Promise<
    Array<{ storeId: string; name: string; organizationId: string | null; unitId: string | null; isActive: boolean; computedAt: Date }>
  > {
    const rows = await applyStoreScope(this.registry.createQueryBuilder('r'), 'r', scope)
      .orderBy('r.name', 'ASC')
      .getMany();
    return rows.map((r) => ({
      storeId: r.storeId,
      name: r.name,
      organizationId: r.organizationId,
      unitId: r.unitId,
      isActive: r.isActive,
      computedAt: r.computedAt,
    }));
  }
}
