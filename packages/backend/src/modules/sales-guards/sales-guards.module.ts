import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { SaleAnomalyLogEntity } from '../../database/entities/sale-anomaly-log.entity';
import { ProductEntity } from '../../database/entities/product.entity';
import { SalesGuardsConfigProvider } from './sales-guards.config';
import { SalesGuardsService } from './sales-guards.service';
import { SalesGuardsController } from './sales-guards.controller';

@Module({
  imports: [TypeOrmModule.forFeature([SaleAnomalyLogEntity, ProductEntity])],
  controllers: [SalesGuardsController],
  providers: [SalesGuardsConfigProvider, SalesGuardsService],
  exports: [SalesGuardsService],
})
export class SalesGuardsModule {}
