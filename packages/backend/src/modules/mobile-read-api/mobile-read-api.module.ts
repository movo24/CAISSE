import { Module } from '@nestjs/common';
import { AnalyticsProjectionModule } from '../analytics-projection/analytics-projection.module';
import { MobileReadController } from './mobile-read.controller';
import { ReadOnlyGuard } from './read-only.guard';

/**
 * Wesley Command Center — étage 1 (mobile-read-api). GET-only read API over the
 * analytics projection. Imports AnalyticsProjectionModule for the INV-5 store-scope
 * resolver (used by the endpoints, added later). Not imported into AppModule yet —
 * activated deliberately once endpoints exist + the scope rule is decided.
 */
@Module({
  imports: [AnalyticsProjectionModule],
  controllers: [MobileReadController],
  providers: [ReadOnlyGuard],
})
export class MobileReadApiModule {}
