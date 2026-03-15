import { CurrencyCode } from './currency';

export interface ZReport {
  id: string;
  storeId: string;
  date: string;
  employeeId: string;
  totalRevenueMinorUnits: number;
  totalTaxMinorUnits: number;
  currencyCode: CurrencyCode;
  cashTotalMinorUnits: number;
  cardTotalMinorUnits: number;
  transactionCount: number;
  averageBasketMinorUnits: number;
  topProducts: { productId: string; name: string; quantity: number; revenueMinorUnits: number }[];
  voidCount: number;
  discountTotalMinorUnits: number;
  peakHours: { hour: number; transactionCount: number }[];
  createdAt: string;
}
