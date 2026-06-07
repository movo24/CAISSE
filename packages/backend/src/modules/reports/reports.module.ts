import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ReportsService } from './reports.service';
import { ProductAnalyticsService } from './product-analytics.service';
import { ReportsController } from './reports.controller';
import { SaleEntity } from '../../database/entities/sale.entity';
import { SaleLineItemEntity } from '../../database/entities/sale-line-item.entity';
import { SalePaymentEntity } from '../../database/entities/sale-payment.entity';
import { ZReportEntity } from '../../database/entities/z-report.entity';
import { ProductEntity } from '../../database/entities/product.entity';
import { StoreEntity } from '../../database/entities/store.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      SaleEntity,
      SaleLineItemEntity,
      SalePaymentEntity,
      ZReportEntity,
      ProductEntity,
      StoreEntity,
    ]),
  ],
  controllers: [ReportsController],
  providers: [ReportsService, ProductAnalyticsService],
  exports: [ReportsService, ProductAnalyticsService],
})
export class ReportsModule {}
