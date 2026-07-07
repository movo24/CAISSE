import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ProductIntegrationController } from './product-integration.controller';
import { ProductIntegrationService } from './product-integration.service';
import { ProductIntegrationRequestEntity } from '../../database/entities/product-integration-request.entity';
import { ProductEntity } from '../../database/entities/product.entity';
import { EmployeeEntity } from '../../database/entities/employee.entity';
import { SaleLineItemEntity } from '../../database/entities/sale-line-item.entity';
import { AuditModule } from '../audit/audit.module';
import { ProductsModule } from '../products/products.module';
import { EmployeeScoreModule } from '../employee-score/employee-score.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      ProductIntegrationRequestEntity,
      ProductEntity,
      EmployeeEntity,
      SaleLineItemEntity,
    ]),
    AuditModule,
    ProductsModule,
    EmployeeScoreModule,
  ],
  controllers: [ProductIntegrationController],
  providers: [ProductIntegrationService],
  exports: [ProductIntegrationService],
})
export class ProductIntegrationModule {}
