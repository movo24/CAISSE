import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ProductsService } from './products.service';
import { ProductsController } from './products.controller';
import { ProductEntity } from '../../database/entities/product.entity';
import { ProductCategoryEntity } from '../../database/entities/product-category.entity';
import { PriceHistoryEntity } from '../../database/entities/price-history.entity';
import { BrandEntity } from '../../database/entities/brand.entity';
import { SupplierEntity } from '../../database/entities/supplier.entity';
import { StoreProductPriceEntity } from '../../database/entities/store-product-price.entity';
import { ProductComponentEntity } from '../../database/entities/product-component.entity';
import { ProductMediaEntity } from '../../database/entities/product-media.entity';
import { ProductDocumentEntity } from '../../database/entities/product-document.entity';
import { ProductBarcodeEntity } from '../../database/entities/product-barcode.entity';
import { ProductSupplierEntity } from '../../database/entities/product-supplier.entity';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([ProductEntity, ProductCategoryEntity, PriceHistoryEntity, BrandEntity, SupplierEntity, StoreProductPriceEntity, ProductComponentEntity, ProductMediaEntity, ProductDocumentEntity, ProductBarcodeEntity, ProductSupplierEntity]),
    AuditModule,
  ],
  controllers: [ProductsController],
  providers: [ProductsService],
  exports: [ProductsService],
})
export class ProductsModule {}
