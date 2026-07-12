/**
 * Wire types for the read-only direction API
 * (`GET /api/mobile/v1/direction/...`) and the auth endpoints. Amounts are
 * integer minor units (centimes) — the app never does float math on money.
 */

export interface PeriodTotals {
  revenueMinorUnits: number;
  transactionCount: number;
  averageBasketMinorUnits: number;
}

export interface PaymentRow {
  method: string;
  count: number;
  amountMinorUnits: number;
}

export interface RankedStore {
  storeId: string;
  name: string;
  revenueMinorUnits: number;
}

export interface DirectionOverview {
  date: string;
  generatedAt: string;
  scope: { storeCount: number };
  today: PeriodTotals & {
    discountTotalMinorUnits: number;
    marginMinorUnits: number | null;
    marginRatePct: number | null;
    marginCoveragePct: number | null;
  };
  comparisons: {
    vsYesterdayPct: number | null;
    vsSameDayLastWeekPct: number | null;
  };
  toDate: {
    weekRevenueMinorUnits: number;
    monthRevenueMinorUnits: number;
    yearRevenueMinorUnits: number;
  };
  payments: PaymentRow[];
  refunds: { count: number; totalMinorUnits: number };
  voids: { count: number };
  stores: { total: number; withSalesToday: number; withOpenSession: number };
  alerts: { stockCritical: number; stockAlert: number; anomaliesOpen: number };
  ranking: { best: RankedStore[]; worst: RankedStore[] };
}

export interface DirectionStoreRow {
  storeId: string;
  name: string;
  city: string | null;
  revenueMinorUnits: number;
  transactionCount: number;
  averageBasketMinorUnits: number;
  vsYesterdayPct: number | null;
  hasOpenSession: boolean;
  lastSaleAt: string | null;
  stockCriticalCount: number;
  stockAlertCount: number;
  anomaliesOpenCount: number;
}

export interface DirectionStoreList {
  date: string;
  stores: DirectionStoreRow[];
}

export interface HourlyPoint {
  hour: number;
  revenueMinorUnits: number;
  transactionCount: number;
}

export interface TopProduct {
  productId: string;
  name: string;
  quantity: number;
  revenueMinorUnits: number;
}

export interface DirectionStoreDetail {
  date: string;
  generatedAt: string;
  store: { id: string; name: string; city: string | null; isActive: boolean } | null;
  kpi: PeriodTotals & {
    discountTotalMinorUnits: number;
    marginMinorUnits: number | null;
    marginRatePct: number | null;
  };
  hourly: HourlyPoint[];
  payments: PaymentRow[];
  topProducts: TopProduct[];
  refunds: { count: number; totalMinorUnits: number };
  voids: { count: number };
  cash: { closedSessionsCounted: number; varianceMinorUnits: number | null };
  sessions: {
    open: {
      id: string;
      employeeName: string;
      terminalId: string | null;
      openedAt: string;
    }[];
  };
  terminals: {
    id: string;
    label: string;
    status: string;
    lastSeenAt: string | null;
  }[];
  alerts: { stockCritical: number; stockAlert: number; anomaliesOpen: number };
}

export interface DirectionCompare {
  from: string;
  to: string;
  stores: {
    storeId: string;
    name: string;
    revenueMinorUnits: number;
    transactionCount: number;
    averageBasketMinorUnits: number;
    marginMinorUnits: number | null;
  }[];
}

/** POS-110 cockpit alerts payload (existing endpoint, reused as-is). */
export interface CockpitAlerts {
  summary: {
    stockAlertCount: number;
    stockCriticalCount: number;
    anomaliesOpenCount: number;
    overall: 'ok' | 'warning' | 'critical';
  };
  stock: {
    critical: { id: string; name: string; ean: string | null; stockQuantity: number }[];
    alert: { id: string; name: string; ean: string | null; stockQuantity: number }[];
  };
  anomalies: {
    id: string;
    code: string;
    severity: string;
    message: string;
    createdAt: string;
  }[];
}

export interface AuthEmployee {
  id: string;
  firstName?: string;
  lastName?: string;
  role: 'admin' | 'manager' | 'cashier';
  storeId: string;
}

export interface AuthResponse {
  accessToken: string;
  refreshToken: string;
  employee: AuthEmployee;
  storeInfo?: { id: string; name: string } | null;
}
