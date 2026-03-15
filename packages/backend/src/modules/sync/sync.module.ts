import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SyncService } from './sync.service';
import { SyncController } from './sync.controller';
import { SaleEntity } from '../../database/entities/sale.entity';
import { ProductEntity } from '../../database/entities/product.entity';
import { CustomerEntity } from '../../database/entities/customer.entity';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([SaleEntity, ProductEntity, CustomerEntity]),
    AuditModule,
  ],
  controllers: [SyncController],
  providers: [SyncService],
  exports: [SyncService],
})
export class SyncModule {}
