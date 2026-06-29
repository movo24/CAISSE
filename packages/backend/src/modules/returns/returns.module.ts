import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ReturnsService } from './returns.service';
import { ReturnsController } from './returns.controller';
import { CreditNoteEntity } from '../../database/entities/credit-note.entity';
import { CreditNoteLineEntity } from '../../database/entities/credit-note-line.entity';
import { CreditNoteRedemptionEntity } from '../../database/entities/credit-note-redemption.entity';
import { SaleEntity } from '../../database/entities/sale.entity';
import { IdempotencyKeyEntity } from '../../database/entities/idempotency-key.entity';
import { IntegrationEventEntity } from '../../database/entities/integration-event.entity';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      CreditNoteEntity,
      CreditNoteLineEntity,
      CreditNoteRedemptionEntity,
      SaleEntity,
      IdempotencyKeyEntity,
      IntegrationEventEntity,
    ]),
    AuditModule,
  ],
  controllers: [ReturnsController],
  providers: [ReturnsService],
  exports: [ReturnsService],
})
export class ReturnsModule {}
