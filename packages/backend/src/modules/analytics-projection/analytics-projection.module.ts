import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { StoreEntity } from '../../database/entities/store.entity';
import { EmployeeStoreAccessEntity } from '../../database/entities/employee-store-access.entity';
import { SaleEntity } from '../../database/entities/sale.entity';
import { CreditNoteEntity } from '../../database/entities/credit-note.entity';
import { PosSessionEntity } from '../../database/entities/pos-session.entity';
import { AnalyticsStoreDailyEntity } from '../../database/entities/analytics-store-daily.entity';
import { AnalyticsStoreSessionsEntity } from '../../database/entities/analytics-store-sessions.entity';
import { AnalyticsStoreRegistryEntity } from '../../database/entities/analytics-store-registry.entity';
import { StoreScopeResolverService } from './store-scope-resolver.service';
import { PosProjectionRefreshService } from './pos-projection-refresh.service';

/**
 * Wesley Command Center — étage 0 (analytics-projection). Read model + refresh.
 * Commit 2: the INV-5 store-scope resolver. Commit 3: the INV-4 refresh jobs
 * (POS here; presence + stock follow). The read API is étage 1 (not here).
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      StoreEntity,
      EmployeeStoreAccessEntity,
      SaleEntity,
      CreditNoteEntity,
      PosSessionEntity,
      AnalyticsStoreDailyEntity,
      AnalyticsStoreSessionsEntity,
      AnalyticsStoreRegistryEntity,
    ]),
  ],
  providers: [StoreScopeResolverService, PosProjectionRefreshService],
  exports: [StoreScopeResolverService, PosProjectionRefreshService],
})
export class AnalyticsProjectionModule {}
