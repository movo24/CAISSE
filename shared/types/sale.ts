import { CurrencyCode } from './currency';

export type PaymentMethod = 'cash' | 'card' | 'mixed';
export type SaleStatus = 'pending' | 'completed' | 'voided' | 'suspended';

export interface SaleLineItem {
  id: string;
  saleId: string;
  productId: string;
  productName: string;
  ean: string;
  quantity: number;
  unitPriceMinorUnits: number;
  discountMinorUnits: number;
  promoId?: string;
  taxRate: number;
  lineTotalMinorUnits: number;
}

export interface SalePayment {
  id: string;
  saleId: string;
  method: PaymentMethod;
  amountMinorUnits: number;
  currencyCode: CurrencyCode;
  reference?: string;
}

export interface Sale {
  id: string;
  storeId: string;
  employeeId: string;
  customerId?: string;
  status: SaleStatus;
  lineItems: SaleLineItem[];
  payments: SalePayment[];
  subtotalMinorUnits: number;
  discountTotalMinorUnits: number;
  taxTotalMinorUnits: number;
  totalMinorUnits: number;
  currencyCode: CurrencyCode;
  createdAt: string;
  completedAt?: string;
  ticketNumber: string;
  hashChainPrev?: string;
  hashChainCurrent?: string;
}
