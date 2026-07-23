import { SetMetadata } from '@nestjs/common';
import { StorePermission } from './application-access.constants';

export const REQUIRE_STORE_ACCESS = 'require_store_access';

export interface RequireStoreAccessMeta {
  permission?: StorePermission;
}

/**
 * Marque un endpoint de pilotage comme protégé par `StoreAccessGuard`.
 * Optionnellement exige une permission granulaire (ex. `can_view_financials`).
 * À combiner avec `@SkipTenantCheck()` (le périmètre multi-magasins remplace le
 * blocage mono-magasin du TenantInterceptor).
 */
export const RequireStoreAccess = (permission?: StorePermission) =>
  SetMetadata(REQUIRE_STORE_ACCESS, { permission } as RequireStoreAccessMeta);
