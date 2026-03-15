import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ReportsService } from './reports.service';
import { ReportsController } from './reports.controller';
import { SaleEntity } from '../../database/entities/sale.entity';
import { SaleLineItemEntity } from '../../database/entities/sale-line-item.entity';
import { SalePaymentEntity } from '../../database/entities/sale-payment.entity';
import { ZReportEntity } from '../../database/entities/z-report.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      SaleEntity,
      SaleLineItemEntity,
      SalePaymentEntity,
      ZReportEntity,
    ]),
  ],
  controllers: [ReportsController],
  providers: [ReportsService],
  exports: [ReportsService],
})
export class ReportsModule {}
