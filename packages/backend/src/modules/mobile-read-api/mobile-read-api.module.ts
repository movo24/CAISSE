import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AnalyticsProjectionModule } from '../analytics-projection/analytics-projection.module';
import { AnalyticsStoreRegistryEntity } from '../../database/entities/analytics-store-registry.entity';
import { AnalyticsStoreDailyEntity } from '../../database/entities/analytics-store-daily.entity';
import { AnalyticsStoreSessionsEntity } from '../../database/entities/analytics-store-sessions.entity';
import { AnalyticsStorePresenceEntity } from '../../database/entities/analytics-store-presence.entity';
import { AnalyticsStoreStockEntity } from '../../database/entities/analytics-store-stock.entity';
import { AnalyticsAlertEntity } from '../../database/entities/analytics-alert.entity';
import { MobileReadController } from './mobile-read.controller';
import { MobileReadService } from './mobile-read.service';
import { ReadOnlyGuard } from './read-only.guard';

/**
 * Wesley Command Center — étage 1 (mobile-read-api). GET-only read API over the
 * analytics projection. forFeature wires ONLY the analytics.* read-model repos (the
 * service reads no source table); AnalyticsProjectionModule provides the INV-5
 * store-scope resolver.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      AnalyticsStoreRegistryEntity,
      AnalyticsStoreDailyEntity,
      AnalyticsStoreSessionsEntity,
      AnalyticsStorePresenceEntity,
      AnalyticsStoreStockEntity,
      AnalyticsAlertEntity,
    ]),
    AnalyticsProjectionModule,
  ],
  controllers: [MobileReadController],
  providers: [MobileReadService, ReadOnlyGuard],
})
export class MobileReadApiModule {}
