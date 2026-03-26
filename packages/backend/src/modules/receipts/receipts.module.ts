import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ReceiptsController } from './receipts.controller';
import { SaleEntity } from '../../database/entities/sale.entity';
import { SaleLineItemEntity } from '../../database/entities/sale-line-item.entity';
import { SalePaymentEntity } from '../../database/entities/sale-payment.entity';
import { StoreEntity } from '../../database/entities/store.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([SaleEntity, SaleLineItemEntity, SalePaymentEntity, StoreEntity]),
  ],
  controllers: [ReceiptsController],
})
export class ReceiptsModule {}
