import { CurrencyCode } from './currency';

export type UnitType = 'unit' | 'pair' | 'kg' | 'meter' | 'liter';

export interface Product {
  id: string;
  ean: string;                 // barcode EAN-13 or custom
  name: string;
  description?: string;
  categoryId: string;
  unitType: UnitType;
  priceMinorUnits: number;     // price in minor units (store currency)
  currencyCode: CurrencyCode;
  costMinorUnits?: number;     // cost price for margin calc
  taxRate: number;             // e.g. 20.0 for 20% TVA
  imageUrl?: string;
  stockQuantity: number;
  stockAlertThreshold: number; // default 10
  stockCriticalThreshold: number; // default 5
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  storeId: string;
}

export interface ProductCategory {
  id: string;
  name: string;
  parentId?: string;
  storeId: string;
}
