import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { PosSessionEntity } from '../../database/entities/pos-session.entity';
import { PosSessionService } from './pos-session.service';
import { PosSessionController } from './pos-session.controller';
import { TimewinModule } from '../timewin/timewin.module';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [TypeOrmModule.forFeature([PosSessionEntity]), TimewinModule, AuditModule],
  controllers: [PosSessionController],
  providers: [PosSessionService],
  exports: [PosSessionService],
})
export class PosSessionModule {}
