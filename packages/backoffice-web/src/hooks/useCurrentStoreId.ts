import { useAuthStore } from '../stores/authStore';

/**
 * Returns the currently selected store ID.
 * Falls back to the employee's home store if no store is explicitly selected.
 * Use this instead of employee.storeId for all API calls.
 */
export function useCurrentStoreId(): string {
  const { currentStoreId, employee } = useAuthStore();
  return currentStoreId || employee?.storeId || '';
}
