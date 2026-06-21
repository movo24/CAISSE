import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ProductEntity } from '../../database/entities/product.entity';
import { StockVarianceEntity } from '../../database/entities/stock-variance.entity';
import { StockModule } from '../stock/stock.module';
import { AuditModule } from '../audit/audit.module';
import { StockReconciliationService } from './stock-reconciliation.service';
import { StockReconciliationController } from './stock-reconciliation.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([ProductEntity, StockVarianceEntity]),
    StockModule,
    AuditModule,
  ],
  controllers: [StockReconciliationController],
  providers: [StockReconciliationService],
  exports: [StockReconciliationService],
})
export class StockReconciliationModule {}
