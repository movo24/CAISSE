import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { StockModule } from '../stock/stock.module';
import { SaleAnomalyLogEntity } from '../../database/entities/sale-anomaly-log.entity';
import { SaleEntity } from '../../database/entities/sale.entity';
import { MobileCockpitController } from './mobile-cockpit.controller';
import { MobileCockpitService } from './mobile-cockpit.service';
import { MobileAnalyticsController } from './mobile-analytics.controller';
import { MobileAnalyticsService } from './mobile-analytics.service';

/**
 * POS-110/112 — Read-only mobile supervision cockpit.
 * P366 — extended with the read-only network analytics API (GET only).
 */
@Module({
  imports: [StockModule, TypeOrmModule.forFeature([SaleAnomalyLogEntity, SaleEntity])],
  controllers: [MobileCockpitController, MobileAnalyticsController],
  providers: [MobileCockpitService, MobileAnalyticsService],
})
export class MobileCockpitModule {}
