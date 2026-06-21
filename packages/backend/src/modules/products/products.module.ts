import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ProductsService } from './products.service';
import { ProductsController } from './products.controller';
import { ProductEntity } from '../../database/entities/product.entity';
import { ProductCategoryEntity } from '../../database/entities/product-category.entity';
import { PriceHistoryEntity } from '../../database/entities/price-history.entity';
import { BrandEntity } from '../../database/entities/brand.entity';
import { SupplierEntity } from '../../database/entities/supplier.entity';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([ProductEntity, ProductCategoryEntity, PriceHistoryEntity, BrandEntity, SupplierEntity]),
    AuditModule,
  ],
  controllers: [ProductsController],
  providers: [ProductsService],
  exports: [ProductsService],
})
export class ProductsModule {}
