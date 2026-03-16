import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { InventoryScanEntity } from '../../database/entities/inventory-scan.entity';
import { ProductEntity } from '../../database/entities/product.entity';
import { StoreEntity } from '../../database/entities/store.entity';
import { InventoryScanController } from './inventory-scan.controller';
import { InventoryScanService } from './inventory-scan.service';
import { StockModule } from '../stock/stock.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      InventoryScanEntity,
      ProductEntity,
      StoreEntity,
    ]),
    StockModule,
  ],
  controllers: [InventoryScanController],
  providers: [InventoryScanService],
  exports: [InventoryScanService],
})
export class InventoryScanModule {}
