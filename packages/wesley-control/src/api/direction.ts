import { apiGet } from './client';
import type {
  CockpitAlerts,
  DirectionCompare,
  DirectionOverview,
  DirectionStoreDetail,
  DirectionStoreList,
} from './types';

export const directionApi = {
  overview: () => apiGet<DirectionOverview>('/mobile/v1/direction/overview'),
  stores: () => apiGet<DirectionStoreList>('/mobile/v1/direction/stores'),
  storeDetail: (id: string) =>
    apiGet<DirectionStoreDetail>(`/mobile/v1/direction/stores/${id}`),
  compare: (storeIds: string[], from: string, to: string) =>
    apiGet<DirectionCompare>(
      `/mobile/v1/direction/compare?storeIds=${storeIds.join(',')}&from=${from}&to=${to}`,
    ),
  /** POS-110 cockpit — reused as-is for the per-store alert drill-down. */
  cockpitAlerts: (storeId?: string) =>
    apiGet<CockpitAlerts>(
      storeId ? `/mobile/v1/alerts?storeId=${storeId}` : '/mobile/v1/alerts',
    ),
};
