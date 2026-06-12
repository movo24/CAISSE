import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { StoreEntity } from '../../database/entities/store.entity';
import { EmployeeStoreAccessEntity } from '../../database/entities/employee-store-access.entity';
import { StoreScopeResolverService } from './store-scope-resolver.service';

/**
 * Wesley Command Center — étage 0 (analytics-projection). Read model + refresh.
 * Commit 2: the INV-5 store-scope resolver. Refresh jobs (INV-4) land in commit 3;
 * the read API is étage 1 (not here).
 */
@Module({
  imports: [TypeOrmModule.forFeature([StoreEntity, EmployeeStoreAccessEntity])],
  providers: [StoreScopeResolverService],
  exports: [StoreScopeResolverService],
})
export class AnalyticsProjectionModule {}
