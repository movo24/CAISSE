import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { StockService } from './stock.service';
import { StockController } from './stock.controller';
import { ProductEntity } from '../../database/entities/product.entity';
import { IntegrationEventEntity } from '../../database/entities/integration-event.entity';
import { AuditModule } from '../audit/audit.module';
import { IntegrationModule } from '../integration/integration.module';

@Module({
  imports: [TypeOrmModule.forFeature([ProductEntity, IntegrationEventEntity]), AuditModule, IntegrationModule],
  controllers: [StockController],
  providers: [StockService],
  exports: [StockService],
})
export class StockModule {}
