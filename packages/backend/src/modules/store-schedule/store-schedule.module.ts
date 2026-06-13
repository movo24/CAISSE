import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AnalyticsStoreWeeklyHoursEntity } from '../../database/entities/analytics-store-weekly-hours.entity';
import { StoreScheduleService } from './store-schedule.service';

/**
 * Schedule resolver module — exports the ONE schedule source (StoreScheduleService).
 * Consumers (alerts engine rule, ai-brief close beat, BackOffice write surface)
 * import this module; none re-derives hours.
 */
@Module({
  imports: [TypeOrmModule.forFeature([AnalyticsStoreWeeklyHoursEntity])],
  providers: [StoreScheduleService],
  exports: [StoreScheduleService],
})
export class StoreScheduleModule {}
