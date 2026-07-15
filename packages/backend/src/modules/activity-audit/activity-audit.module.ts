import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UserLoginEventEntity } from '../../database/entities/user-login-event.entity';
import { UserSessionEntity } from '../../database/entities/user-session.entity';
import { PilotageAccessModule } from '../pilotage-access/pilotage-access.module';
import { ActivityService } from './activity.service';
import { ActivityAdminController } from './activity-admin.controller';

/**
 * Module de télémétrie : connexions + sessions (Lot 6), consultations (Lot 7).
 * Importe PilotageAccessModule pour tracer les révocations dans access_audit_log.
 */
@Module({
  imports: [TypeOrmModule.forFeature([UserLoginEventEntity, UserSessionEntity]), PilotageAccessModule],
  controllers: [ActivityAdminController],
  providers: [ActivityService],
  exports: [ActivityService],
})
export class ActivityAuditModule {}
