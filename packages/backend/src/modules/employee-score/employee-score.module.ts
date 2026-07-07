import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { EmployeeScoreController } from './employee-score.controller';
import { EmployeeScoreService } from './employee-score.service';
import { EmployeeScoreCron } from './employee-score.cron';
import { EmployeeScoreEventEntity } from '../../database/entities/employee-score-event.entity';
import { EmployeeScoreRuleEntity } from '../../database/entities/employee-score-rule.entity';
import { EmployeeScoreDailyEntity } from '../../database/entities/employee-score-daily.entity';
import { PosSessionEntity } from '../../database/entities/pos-session.entity';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      EmployeeScoreEventEntity,
      EmployeeScoreRuleEntity,
      EmployeeScoreDailyEntity,
      PosSessionEntity,
    ]),
    AuditModule,
  ],
  controllers: [EmployeeScoreController],
  providers: [EmployeeScoreService, EmployeeScoreCron],
  exports: [EmployeeScoreService],
})
export class EmployeeScoreModule {}
