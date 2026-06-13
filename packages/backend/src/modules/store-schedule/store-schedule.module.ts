import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AnalyticsStoreWeeklyHoursEntity } from '../../database/entities/analytics-store-weekly-hours.entity';
import { AnalyticsStoreHolidayClosureEntity } from '../../database/entities/analytics-store-holiday-closure.entity';
import { StoreScheduleService } from './store-schedule.service';
import { StoreScheduleAdminService } from './store-schedule-admin.service';

/**
 * Schedule resolver module — exports the ONE schedule source (StoreScheduleService).
 * Consumers (alerts engine rule, ai-brief close beat, BackOffice write surface)
 * import this module; none re-derives hours.
 */
@Module({
  imports: [TypeOrmModule.forFeature([AnalyticsStoreWeeklyHoursEntity, AnalyticsStoreHolidayClosureEntity])],
  providers: [StoreScheduleService, StoreScheduleAdminService],
  exports: [StoreScheduleService, StoreScheduleAdminService],
})
export class StoreScheduleModule {}
