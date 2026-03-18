import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { IaService } from './ia.service';
import { IaController } from './ia.controller';
import { ClaudeService } from './claude.service';
import { IaDataService } from './ia-data.service';
import { ProductEntity } from '../../database/entities/product.entity';
import { SaleEntity } from '../../database/entities/sale.entity';
import { SaleLineItemEntity } from '../../database/entities/sale-line-item.entity';
import { ZReportEntity } from '../../database/entities/z-report.entity';
import { EmployeeEntity } from '../../database/entities/employee.entity';
import { StoreEntity } from '../../database/entities/store.entity';

@Module({
  imports: [
    ConfigModule,
    TypeOrmModule.forFeature([
      ProductEntity,
      SaleEntity,
      SaleLineItemEntity,
      ZReportEntity,
      EmployeeEntity,
      StoreEntity,
    ]),
  ],
  controllers: [IaController],
  providers: [IaService, ClaudeService, IaDataService],
  exports: [IaService, ClaudeService],
})
export class IaModule {}
