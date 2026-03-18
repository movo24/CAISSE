import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LivePerformanceController } from './live-performance.controller';
import { LivePerformanceService } from './live-performance.service';
import { StoreEntity } from '../../database/entities/store.entity';
import { SaleEntity } from '../../database/entities/sale.entity';
import { SaleLineItemEntity } from '../../database/entities/sale-line-item.entity';
import { IaModule } from '../ia/ia.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([StoreEntity, SaleEntity, SaleLineItemEntity]),
    IaModule,
  ],
  controllers: [LivePerformanceController],
  providers: [LivePerformanceService],
})
export class LivePerformanceModule {}
