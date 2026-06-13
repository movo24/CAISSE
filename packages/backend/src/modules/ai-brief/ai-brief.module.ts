import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { StoreScheduleModule } from '../store-schedule/store-schedule.module';
import { AnalyticsStoreDailyEntity } from '../../database/entities/analytics-store-daily.entity';
import { AnalyticsStoreSessionsEntity } from '../../database/entities/analytics-store-sessions.entity';
import { AnalyticsStorePresenceEntity } from '../../database/entities/analytics-store-presence.entity';
import { AnalyticsStoreStockEntity } from '../../database/entities/analytics-store-stock.entity';
import { AnalyticsStoreRegistryEntity } from '../../database/entities/analytics-store-registry.entity';
import { AnalyticsAlertEntity } from '../../database/entities/analytics-alert.entity';
import { AnalyticsStoreTargetEntity } from '../../database/entities/analytics-store-target.entity';
import { AnalyticsBriefEntity } from '../../database/entities/analytics-brief.entity';
import { AnalyticsStoreClockEntity } from '../../database/entities/analytics-store-clock.entity';
import { AnalyticsProjectionModule } from '../analytics-projection/analytics-projection.module';
import { ReadOnlyGuard } from '../mobile-read-api/read-only.guard';
import { BriefFindingsService } from './brief-findings.service';
import { BRIEF_NARRATOR } from './brief-narrator.interface';
import { makeBriefNarrator } from './haiku-brief.narrator';
import { AiBriefService } from './ai-brief.service';
import { AiBriefController } from './ai-brief.controller';

/**
 * Wesley Command Center — étage 3 (ai-brief). Findings (deterministic) → narrator
 * (untrusted seam, default = the provider-free template; the concrete LLM provider
 * is an owner decision wired on BRIEF_NARRATOR) → provenance guard → persisted
 * brief, served GET-only on the cockpit surface. Reads analytics.* only (INV-2).
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      AnalyticsStoreDailyEntity,
      AnalyticsStoreSessionsEntity,
      AnalyticsStorePresenceEntity,
      AnalyticsStoreStockEntity,
      AnalyticsStoreRegistryEntity,
      AnalyticsAlertEntity,
      AnalyticsStoreTargetEntity,
      AnalyticsBriefEntity,
      AnalyticsStoreClockEntity,
    ]),
    AnalyticsProjectionModule,
    StoreScheduleModule,
  ],
  controllers: [AiBriefController],
  providers: [
    BriefFindingsService,
    {
      // Ratified provider: Haiku 4.5 behind the seam when ANTHROPIC_API_KEY is
      // set (env only, never hardcoded); otherwise the deterministic template —
      // the cockpit is fully functional without any provider (the floor).
      provide: BRIEF_NARRATOR,
      useFactory: (config: ConfigService) => makeBriefNarrator(config.get<string>('ANTHROPIC_API_KEY')),
      inject: [ConfigService],
    },
    AiBriefService,
    ReadOnlyGuard,
  ],
  exports: [AiBriefService],
})
export class AiBriefModule {}
