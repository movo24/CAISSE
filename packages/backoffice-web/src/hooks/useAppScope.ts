import { useAuthStore } from '../stores/authStore';

/**
 * Application Scope — the master context for the entire backoffice.
 *
 * Every page and every API call must respect this scope.
 * When scope = 'global', data is consolidated across all stores.
 * When scope = 'store', data is filtered to selectedStoreId.
 *
 * Architecture:
 *   Couche 0: AppScope (this hook)
 *   Couche 1: Dashboard global (scope=global)
 *   Couche 2: Structure (organizations, units, stores)
 *   Couche 3: Exploitation magasin (scope=store)
 *   Couche 4: Equipes / RH (scope=store or global)
 *   Couche 5: Analyse (scope=global or store)
 *   Couche 6: Stock / Logistique (scope=global or store)
 *   Couche 7: Reglages (scope=store)
 */

export type AppScopeType = 'global' | 'store';

export interface AppScope {
  /** Current scope: 'global' = network view, 'store' = single store */
  scope: AppScopeType;
  /** Selected store ID (null when scope = global) */
  selectedStoreId: string | null;
  /** Selected store name (for display) */
  selectedStoreName: string | null;
  /** User role */
  userRole: string;
  /** Is admin (can see global + all stores) */
  isAdmin: boolean;
  /** Is in global scope */
  isGlobal: boolean;
  /** Is in store scope */
  isStore: boolean;
  /** The effective storeId for API calls — null means "all stores" */
  effectiveStoreId: string | null;
  /** Switch to global scope */
  switchToGlobal: () => void;
  /** Switch to a specific store scope */
  switchToStore: (storeId: string) => void;
  /** All available stores */
  stores: Array<{ id: string; name: string; city?: string }>;
}

export function useAppScope(): AppScope {
  const {
    employee,
    currentStoreId,
    stores,
    setCurrentStore,
  } = useAuthStore();

  const userRole = employee?.role || 'cashier';
  const isAdmin = userRole === 'admin';

  // Determine scope: admin without a selected store = global
  // Non-admins are always in store scope (their own store)
  const scope: AppScopeType = isAdmin && !currentStoreId ? 'global' : 'store';
  const isGlobal = scope === 'global';
  const isStore = scope === 'store';

  // Find current store name
  const currentStore = stores.find((s) => s.id === currentStoreId);
  const selectedStoreName = currentStore?.name || null;

  // Effective storeId for API calls
  // Global scope → null (APIs should fetch all stores)
  // Store scope → the selected store
  const effectiveStoreId = isGlobal ? null : (currentStoreId || employee?.storeId || null);

  const switchToGlobal = () => {
    if (isAdmin) {
      setCurrentStore(null as any); // Clear store selection → global scope
      localStorage.removeItem('currentStoreId');
    }
  };

  const switchToStore = (storeId: string) => {
    setCurrentStore(storeId);
  };

  return {
    scope,
    selectedStoreId: currentStoreId || null,
    selectedStoreName,
    userRole,
    isAdmin,
    isGlobal,
    isStore,
    effectiveStoreId,
    switchToGlobal,
    switchToStore,
    stores,
  };
}
