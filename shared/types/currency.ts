/** ISO 4217 currency codes supported */
export type CurrencyCode =
  | 'EUR' | 'GBP' | 'USD' | 'AED' | 'JPY'
  | 'DZD' | 'MAD' | 'TND' | 'SAR' | 'QAR'
  | 'BHD' | 'CHF';

export interface CurrencyConfig {
  code: CurrencyCode;
  name: string;
  symbol: string;
  precision: number;       // decimal places: EUR=2, JPY=0, BHD=3
  symbolPosition: 'before' | 'after';
  thousandSeparator: string;
  decimalSeparator: string;
}

/** All amounts stored as integers in minor units */
export interface MoneyAmount {
  amount: number;          // integer, minor units (e.g. 199 = 1.99 EUR)
  currencyCode: CurrencyCode;
}

export interface FxRate {
  id: string;
  baseCurrency: CurrencyCode;
  quoteCurrency: CurrencyCode;
  rate: number;            // float, e.g. 1.0856
  source: string;          // 'manual' | 'ecb' | 'openexchangerates'
  timestamp: string;       // ISO datetime
}

export const CURRENCY_CONFIGS: Record<CurrencyCode, CurrencyConfig> = {
  EUR: { code: 'EUR', name: 'Euro', symbol: '\u20ac', precision: 2, symbolPosition: 'after', thousandSeparator: ' ', decimalSeparator: ',' },
  GBP: { code: 'GBP', name: 'British Pound', symbol: '\u00a3', precision: 2, symbolPosition: 'before', thousandSeparator: ',', decimalSeparator: '.' },
  USD: { code: 'USD', name: 'US Dollar', symbol: '$', precision: 2, symbolPosition: 'before', thousandSeparator: ',', decimalSeparator: '.' },
  AED: { code: 'AED', name: 'UAE Dirham', symbol: '\u062f.\u0625', precision: 2, symbolPosition: 'after', thousandSeparator: ',', decimalSeparator: '.' },
  JPY: { code: 'JPY', name: 'Japanese Yen', symbol: '\u00a5', precision: 0, symbolPosition: 'before', thousandSeparator: ',', decimalSeparator: '.' },
  DZD: { code: 'DZD', name: 'Algerian Dinar', symbol: '\u062f.\u062c', precision: 2, symbolPosition: 'after', thousandSeparator: ' ', decimalSeparator: ',' },
  MAD: { code: 'MAD', name: 'Moroccan Dirham', symbol: '\u062f.\u0645.', precision: 2, symbolPosition: 'after', thousandSeparator: ' ', decimalSeparator: ',' },
  TND: { code: 'TND', name: 'Tunisian Dinar', symbol: '\u062f.\u062a', precision: 3, symbolPosition: 'after', thousandSeparator: ' ', decimalSeparator: ',' },
  SAR: { code: 'SAR', name: 'Saudi Riyal', symbol: '\u0631.\u0633', precision: 2, symbolPosition: 'after', thousandSeparator: ',', decimalSeparator: '.' },
  QAR: { code: 'QAR', name: 'Qatari Riyal', symbol: '\u0631.\u0642', precision: 2, symbolPosition: 'after', thousandSeparator: ',', decimalSeparator: '.' },
  BHD: { code: 'BHD', name: 'Bahraini Dinar', symbol: '.\u062f.\u0628', precision: 3, symbolPosition: 'after', thousandSeparator: ',', decimalSeparator: '.' },
  CHF: { code: 'CHF', name: 'Swiss Franc', symbol: 'CHF', precision: 2, symbolPosition: 'before', thousandSeparator: "'", decimalSeparator: '.' },
};
