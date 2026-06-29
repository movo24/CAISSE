import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { PosSessionEntity } from '../../database/entities/pos-session.entity';
import { IntegrationEventEntity } from '../../database/entities/integration-event.entity';
import { PosSessionService } from './pos-session.service';
import { PosSessionController } from './pos-session.controller';
import { IntegrationModule } from '../integration/integration.module';

@Module({
  imports: [TypeOrmModule.forFeature([PosSessionEntity, IntegrationEventEntity]), IntegrationModule],
  controllers: [PosSessionController],
  providers: [PosSessionService],
  exports: [PosSessionService],
})
export class PosSessionModule {}
