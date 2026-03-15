import { CurrencyCode, CURRENCY_CONFIGS, MoneyAmount } from '../types/currency';

/** Convert minor units to display string: 199 EUR -> "1,99 \u20ac" */
export function formatMoney(amount: number, currencyCode: CurrencyCode): string {
  const config = CURRENCY_CONFIGS[currencyCode];
  if (!config) return `${amount} ${currencyCode}`;

  const major = amount / Math.pow(10, config.precision);
  const formatted = major.toFixed(config.precision).replace('.', config.decimalSeparator);

  // Add thousand separators
  const parts = formatted.split(config.decimalSeparator);
  parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, config.thousandSeparator);
  const numberStr =
    config.precision > 0 ? parts[0] + config.decimalSeparator + parts[1] : parts[0];

  return config.symbolPosition === 'before'
    ? `${config.symbol}${numberStr}`
    : `${numberStr} ${config.symbol}`;
}

/** Round to currency precision */
export function roundToCurrency(amount: number, _currencyCode: CurrencyCode): number {
  return Math.round(amount); // already in minor units (integers)
}

/** Convert between currencies using an FX rate */
export function convertCurrency(
  amount: number,
  fromCurrency: CurrencyCode,
  toCurrency: CurrencyCode,
  rate: number,
): MoneyAmount {
  if (fromCurrency === toCurrency) return { amount, currencyCode: toCurrency };

  const fromConfig = CURRENCY_CONFIGS[fromCurrency];
  const toConfig = CURRENCY_CONFIGS[toCurrency];

  // Convert to major, apply rate, convert back to minor
  const majorFrom = amount / Math.pow(10, fromConfig.precision);
  const majorTo = majorFrom * rate;
  const minorTo = Math.round(majorTo * Math.pow(10, toConfig.precision));

  return { amount: minorTo, currencyCode: toCurrency };
}

/** Calculate tax from gross amount (tax-inclusive price) */
export function extractTax(
  grossMinorUnits: number,
  taxRatePercent: number,
): { netMinorUnits: number; taxMinorUnits: number } {
  const net = Math.round(grossMinorUnits / (1 + taxRatePercent / 100));
  const tax = grossMinorUnits - net;
  return { netMinorUnits: net, taxMinorUnits: tax };
}
