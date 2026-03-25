import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SaleEntity } from '../../database/entities/sale.entity';
import { SaleLineItemEntity } from '../../database/entities/sale-line-item.entity';
import { ProductEntity } from '../../database/entities/product.entity';
import { SalesAiService } from './sales-ai.service';
import { SalesAiController } from './sales-ai.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([SaleEntity, SaleLineItemEntity, ProductEntity]),
  ],
  controllers: [SalesAiController],
  providers: [SalesAiService],
  exports: [SalesAiService],
})
export class SalesAiModule {}
