export class TopProductDto {
  name: string;
  quantity: number;
}

export class StorePerformanceDto {
  storeId: string;
  storeName: string;
  rank: number;
  todayRevenue: number;
  todayTransactions: number;
  avgBasket: number;
  currentHourRevenue: number;
  currentHourTransactions: number;
  lastSaleAt: string | null;
  isInactive: boolean;
  topProducts: TopProductDto[];
}

export class NetworkSnapshotDto {
  networkId: string;
  stores: StorePerformanceDto[];
  totalNetworkRevenue: number;
  generatedAt: string;
}

export class InactiveAlertDto {
  storeName: string;
  minutesSinceLastSale: number;
}

export class CompactComparisonDto {
  myRank: number;
  totalStores: number;
  myRevenue: number;
  leaderRevenue: number;
  deltaPercent: number;
  myStoreName: string;
  leaderStoreName: string;
  inactiveAlerts: InactiveAlertDto[];
}
