import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { StockModule } from '../stock/stock.module';
import { SaleAnomalyLogEntity } from '../../database/entities/sale-anomaly-log.entity';
import { MobileCockpitController } from './mobile-cockpit.controller';
import { MobileCockpitService } from './mobile-cockpit.service';

/**
 * POS-110/112 — Read-only mobile supervision cockpit.
 */
@Module({
  imports: [StockModule, TypeOrmModule.forFeature([SaleAnomalyLogEntity])],
  controllers: [MobileCockpitController],
  providers: [MobileCockpitService],
})
export class MobileCockpitModule {}
