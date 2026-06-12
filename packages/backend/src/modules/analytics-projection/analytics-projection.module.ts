import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { StoreEntity } from '../../database/entities/store.entity';
import { EmployeeStoreAccessEntity } from '../../database/entities/employee-store-access.entity';
import { SaleEntity } from '../../database/entities/sale.entity';
import { CreditNoteEntity } from '../../database/entities/credit-note.entity';
import { PosSessionEntity } from '../../database/entities/pos-session.entity';
import { StockLocationEntity } from '../../database/entities/stock-location.entity';
import { StockBalanceEntity } from '../../database/entities/stock-balance.entity';
import { AnalyticsStoreDailyEntity } from '../../database/entities/analytics-store-daily.entity';
import { AnalyticsStoreSessionsEntity } from '../../database/entities/analytics-store-sessions.entity';
import { AnalyticsStorePresenceEntity } from '../../database/entities/analytics-store-presence.entity';
import { AnalyticsStoreStockEntity } from '../../database/entities/analytics-store-stock.entity';
import { AnalyticsStoreRegistryEntity } from '../../database/entities/analytics-store-registry.entity';
import { TimewinModule } from '../timewin/timewin.module';
import { StoreScopeResolverService } from './store-scope-resolver.service';
import { PosProjectionRefreshService } from './pos-projection-refresh.service';
import { PresenceProjectionRefreshService } from './presence-projection-refresh.service';
import { StockProjectionRefreshService } from './stock-projection-refresh.service';

/**
 * Wesley Command Center — étage 0 (analytics-projection). Read model + INV-4 refresh
 * jobs (POS / presence / stock). Commit 2: the INV-5 store-scope resolver. The read
 * API is étage 1 (not here). The @Cron jobs stay inert until this module is imported
 * into AppModule (kept out for now — read-model + jobs only).
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      StoreEntity,
      EmployeeStoreAccessEntity,
      SaleEntity,
      CreditNoteEntity,
      PosSessionEntity,
      StockLocationEntity,
      StockBalanceEntity,
      AnalyticsStoreDailyEntity,
      AnalyticsStoreSessionsEntity,
      AnalyticsStorePresenceEntity,
      AnalyticsStoreStockEntity,
      AnalyticsStoreRegistryEntity,
    ]),
    TimewinModule,
  ],
  providers: [
    StoreScopeResolverService,
    PosProjectionRefreshService,
    PresenceProjectionRefreshService,
    StockProjectionRefreshService,
  ],
  exports: [
    StoreScopeResolverService,
    PosProjectionRefreshService,
    PresenceProjectionRefreshService,
    StockProjectionRefreshService,
  ],
})
export class AnalyticsProjectionModule {}
