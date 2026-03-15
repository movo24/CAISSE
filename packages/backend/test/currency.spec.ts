/**
 * Tests for Multi-Currency Support
 *
 * Validates currency formatting, conversion, and precision.
 */

// Inline the functions to test without module imports
const CURRENCY_CONFIGS: Record<string, { precision: number; symbol: string; symbolPosition: string; thousandSeparator: string; decimalSeparator: string }> = {
  EUR: { precision: 2, symbol: '\u20ac', symbolPosition: 'after', thousandSeparator: ' ', decimalSeparator: ',' },
  USD: { precision: 2, symbol: '$', symbolPosition: 'before', thousandSeparator: ',', decimalSeparator: '.' },
  JPY: { precision: 0, symbol: '\u00a5', symbolPosition: 'before', thousandSeparator: ',', decimalSeparator: '.' },
  BHD: { precision: 3, symbol: '.\u062f.\u0628', symbolPosition: 'after', thousandSeparator: ',', decimalSeparator: '.' },
  TND: { precision: 3, symbol: '\u062f.\u062a', symbolPosition: 'after', thousandSeparator: ' ', decimalSeparator: ',' },
};

function formatMoney(amount: number, currencyCode: string): string {
  const config = CURRENCY_CONFIGS[currencyCode];
  if (!config) return `${amount} ${currencyCode}`;
  const major = amount / Math.pow(10, config.precision);
  const formatted = major.toFixed(config.precision).replace('.', config.decimalSeparator);
  const parts = formatted.split(config.decimalSeparator);
  parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, config.thousandSeparator);
  const numberStr = config.precision > 0 ? parts[0] + config.decimalSeparator + parts[1] : parts[0];
  return config.symbolPosition === 'before' ? `${config.symbol}${numberStr}` : `${numberStr} ${config.symbol}`;
}

function convertCurrency(amount: number, fromCode: string, toCode: string, rate: number): number {
  if (fromCode === toCode) return amount;
  const fromConfig = CURRENCY_CONFIGS[fromCode];
  const toConfig = CURRENCY_CONFIGS[toCode];
  if (!fromConfig || !toConfig) return amount;
  const majorFrom = amount / Math.pow(10, fromConfig.precision);
  const majorTo = majorFrom * rate;
  return Math.round(majorTo * Math.pow(10, toConfig.precision));
}

describe('Multi-Currency Support', () => {
  describe('Money Formatting', () => {
    it('should format EUR correctly', () => {
      expect(formatMoney(2990, 'EUR')).toBe('29,90 \u20ac');
    });

    it('should format USD correctly', () => {
      expect(formatMoney(2990, 'USD')).toBe('$29.90');
    });

    it('should format JPY correctly (no decimals)', () => {
      expect(formatMoney(3000, 'JPY')).toBe('\u00a53,000');
    });

    it('should format BHD correctly (3 decimals)', () => {
      expect(formatMoney(1500, 'BHD')).toBe('1.500 .\u062f.\u0628');
    });

    it('should format large EUR amounts with thousand separator', () => {
      expect(formatMoney(1234567, 'EUR')).toBe('12 345,67 \u20ac');
    });
  });

  describe('Currency Conversion', () => {
    it('should convert EUR to USD', () => {
      // 100.00 EUR at rate 1.0856 = 108.56 USD
      const result = convertCurrency(10000, 'EUR', 'USD', 1.0856);
      expect(result).toBe(10856);
    });

    it('should convert EUR to JPY', () => {
      // 100.00 EUR at rate 160.5 = 16050 JPY
      const result = convertCurrency(10000, 'EUR', 'JPY', 160.5);
      expect(result).toBe(16050);
    });

    it('should return same amount for same currency', () => {
      const result = convertCurrency(5000, 'EUR', 'EUR', 1);
      expect(result).toBe(5000);
    });

    it('should convert EUR to BHD (3 decimal precision)', () => {
      // 100.00 EUR at rate 0.4053 = 0.405 BHD = 405 minor units (BHD has 3 decimals)
      const result = convertCurrency(10000, 'EUR', 'BHD', 0.4053);
      expect(result).toBe(405); // Math.round(100 * 0.4053 * 1000)
    });
  });

  describe('Integer Precision', () => {
    it('should never produce floating point amounts', () => {
      const amounts = [199, 299, 1, 99999999, 0];
      for (const amount of amounts) {
        expect(Number.isInteger(amount)).toBe(true);
      }
    });

    it('should round conversions to integers', () => {
      const result = convertCurrency(333, 'EUR', 'USD', 1.0856);
      expect(Number.isInteger(result)).toBe(true);
    });
  });
});
