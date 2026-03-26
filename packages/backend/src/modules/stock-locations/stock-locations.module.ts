import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { StockLocationEntity } from '../../database/entities/stock-location.entity';
import { StockBalanceEntity } from '../../database/entities/stock-balance.entity';
import { StockMovementEntity } from '../../database/entities/stock-movement.entity';
import { ProductEntity } from '../../database/entities/product.entity';
import { StockLocationsService } from './stock-locations.service';
import { StockLocationsController } from './stock-locations.controller';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      StockLocationEntity,
      StockBalanceEntity,
      StockMovementEntity,
      ProductEntity,
    ]),
    AuditModule,
  ],
  controllers: [StockLocationsController],
  providers: [StockLocationsService],
  exports: [StockLocationsService],
})
export class StockLocationsModule {}
