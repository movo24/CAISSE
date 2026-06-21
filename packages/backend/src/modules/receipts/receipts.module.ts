import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ReceiptsController } from './receipts.controller';
import { SaleEntity } from '../../database/entities/sale.entity';
import { SaleLineItemEntity } from '../../database/entities/sale-line-item.entity';
import { SalePaymentEntity } from '../../database/entities/sale-payment.entity';
import { StoreEntity } from '../../database/entities/store.entity';
import { CreditNoteEntity } from '../../database/entities/credit-note.entity';
import { CreditNoteLineEntity } from '../../database/entities/credit-note-line.entity';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      SaleEntity,
      SaleLineItemEntity,
      SalePaymentEntity,
      StoreEntity,
      CreditNoteEntity,
      CreditNoteLineEntity,
    ]),
    AuditModule,
  ],
  controllers: [ReceiptsController],
})
export class ReceiptsModule {}
