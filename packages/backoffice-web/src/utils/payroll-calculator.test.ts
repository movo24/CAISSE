import { describe, it, expect } from 'vitest';
import { formatCurrency, formatHours } from './payroll-calculator';

describe('payroll-calculator formatters', () => {
  it('formatCurrency renders cents as FR-locale euros', () => {
    expect(formatCurrency(0)).toContain('€');
    expect(formatCurrency(123450)).toMatch(/1[\s ]?234,50/); // 1 234,50 €
    expect(formatCurrency(99)).toMatch(/0,99/);
  });

  it('formatHours renders decimal hours as Xh / XhMM', () => {
    expect(formatHours(7)).toBe('7h');
    expect(formatHours(7.5)).toBe('7h30');
    expect(formatHours(8.25)).toBe('8h15');
    expect(formatHours(0)).toBe('0h');
  });
});
