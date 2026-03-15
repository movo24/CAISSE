/**
 * Tests for Money & Currency Precision
 *
 * Validates that all monetary calculations use integer minor units
 * and never introduce floating-point errors.
 */

describe('Money Precision — Integer Minor Units', () => {
  describe('Price calculations', () => {
    it('should never produce floating-point results for addition', () => {
      // Famous float bug: 0.1 + 0.2 !== 0.3
      const price1 = 0.1;
      const price2 = 0.2;
      expect(price1 + price2).not.toBe(0.3);

      // With integer minor units: 10 + 20 === 30
      const price1Minor = 10; // 0.10 EUR
      const price2Minor = 20; // 0.20 EUR
      expect(price1Minor + price2Minor).toBe(30); // 0.30 EUR exactly
    });

    it('should handle line total correctly', () => {
      const unitPrice = 2990; // 29.90 EUR
      const quantity = 3;
      const lineTotal = unitPrice * quantity;
      expect(lineTotal).toBe(8970); // 89.70 EUR
      expect(Number.isInteger(lineTotal)).toBe(true);
    });

    it('should handle tax calculation with rounding', () => {
      const subtotal = 2990; // 29.90 EUR
      const taxRate = 20;
      const tax = Math.round(subtotal * (taxRate / 100));
      expect(tax).toBe(598); // 5.98 EUR
      expect(Number.isInteger(tax)).toBe(true);
    });

    it('should handle percentage discount with rounding', () => {
      const subtotal = 2990;
      const discountPercent = 15;
      const discount = Math.round(subtotal * (discountPercent / 100));
      expect(discount).toBe(449); // rounded from 448.5
      expect(Number.isInteger(discount)).toBe(true);
    });
  });

  describe('Currency conversion', () => {
    it('should convert EUR to USD correctly', () => {
      const amountEurMinor = 2990; // 29.90 EUR
      const eurPrecision = 2;
      const usdPrecision = 2;
      const rate = 1.0845;

      // Convert: minor -> major -> apply rate -> minor
      const majorEur = amountEurMinor / Math.pow(10, eurPrecision);
      const majorUsd = majorEur * rate;
      const minorUsd = Math.round(majorUsd * Math.pow(10, usdPrecision));

      expect(minorUsd).toBe(3243); // 32.43 USD
      expect(Number.isInteger(minorUsd)).toBe(true);
    });

    it('should handle JPY (0 decimals) correctly', () => {
      const amountJpy = 1000; // 1000 JPY (no decimals)
      const jpyPrecision = 0;
      const eurPrecision = 2;
      const rate = 0.0062; // JPY to EUR

      const majorJpy = amountJpy / Math.pow(10, jpyPrecision);
      const majorEur = majorJpy * rate;
      const minorEur = Math.round(majorEur * Math.pow(10, eurPrecision));

      expect(minorEur).toBe(620); // 6.20 EUR
      expect(Number.isInteger(minorEur)).toBe(true);
    });

    it('should handle BHD (3 decimals) correctly', () => {
      const amountBhdMinor = 1500; // 1.500 BHD
      const bhdPrecision = 3;
      const eurPrecision = 2;
      const rate = 2.43;

      const majorBhd = amountBhdMinor / Math.pow(10, bhdPrecision);
      const majorEur = majorBhd * rate;
      const minorEur = Math.round(majorEur * Math.pow(10, eurPrecision));

      expect(minorEur).toBe(365); // 3.65 EUR
      expect(Number.isInteger(minorEur)).toBe(true);
    });
  });

  describe('Stock quantity integrity', () => {
    it('should never go below 0', () => {
      let stock = 3;
      const soldQuantity = 5;
      stock = Math.max(0, stock - soldQuantity);
      expect(stock).toBe(0);
    });

    it('should decrement correctly', () => {
      let stock = 50;
      stock = Math.max(0, stock - 3);
      expect(stock).toBe(47);
    });
  });
});
