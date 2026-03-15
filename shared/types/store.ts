import { CurrencyCode } from './currency';

export interface Store {
  id: string;
  name: string;
  address: string;
  phone?: string;
  email?: string;
  currencyCode: CurrencyCode;
  timezone: string;
  taxId?: string;
  isActive: boolean;
  createdAt: string;
}
