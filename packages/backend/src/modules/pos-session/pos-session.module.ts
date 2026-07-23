import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { PosSessionEntity } from '../../database/entities/pos-session.entity';
import { SalePaymentEntity } from '../../database/entities/sale-payment.entity';
import { SaleEntity } from '../../database/entities/sale.entity';
import { CreditNoteEntity } from '../../database/entities/credit-note.entity';
import { PosSessionService } from './pos-session.service';
import { PosSessionController } from './pos-session.controller';
import { TimewinModule } from '../timewin/timewin.module';
import { AuditModule } from '../audit/audit.module';
import { EmployeeScoreModule } from '../employee-score/employee-score.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([PosSessionEntity, SalePaymentEntity, CreditNoteEntity, SaleEntity]),
    TimewinModule,
    AuditModule,
    EmployeeScoreModule,
  ],
  controllers: [PosSessionController],
  providers: [PosSessionService],
  exports: [PosSessionService],
})
export class PosSessionModule {}
