import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SalesService } from './sales.service';
import { SalesController } from './sales.controller';
import { SaleEntity } from '../../database/entities/sale.entity';
import { SaleLineItemEntity } from '../../database/entities/sale-line-item.entity';
import { SalePaymentEntity } from '../../database/entities/sale-payment.entity';
import { IdempotencyKeyEntity } from '../../database/entities/idempotency-key.entity';
import { FiscalJournalEntity } from '../../database/entities/fiscal-journal.entity';
import { ProductsModule } from '../products/products.module';
import { CustomersModule } from '../customers/customers.module';
import { PromotionsModule } from '../promotions/promotions.module';
import { AuditModule } from '../audit/audit.module';
import { StockModule } from '../stock/stock.module';
import { JackpotModule } from '../jackpot/jackpot.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      SaleEntity,
      SaleLineItemEntity,
      SalePaymentEntity,
      IdempotencyKeyEntity,
      FiscalJournalEntity,
    ]),
    ProductsModule,
    CustomersModule,
    PromotionsModule,
    AuditModule,
    StockModule,
    JackpotModule,
  ],
  controllers: [SalesController],
  providers: [SalesService],
  exports: [SalesService],
})
export class SalesModule {}
