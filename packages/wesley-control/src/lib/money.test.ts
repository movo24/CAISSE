import { describe, expect, it } from 'vitest';

import { formatMoneyMinor, formatPct } from './money';

describe('formatMoneyMinor', () => {
  it('formats centimes as French euros', () => {
    expect(formatMoneyMinor(123456)).toBe('1 234,56 €');
    expect(formatMoneyMinor(5)).toBe('0,05 €');
    expect(formatMoneyMinor(0)).toBe('0,00 €');
  });

  it('handles negative amounts (écarts de caisse)', () => {
    expect(formatMoneyMinor(-2050)).toBe('-20,50 €');
  });

  it('groups thousands with spaces', () => {
    expect(formatMoneyMinor(987654321)).toBe('9 876 543,21 €');
  });

  it('compacts large amounts when asked (French decimal comma)', () => {
    expect(formatMoneyMinor(1234500, 'EUR', { compact: true })).toBe('12,3 k€');
    expect(formatMoneyMinor(250000000, 'EUR', { compact: true })).toBe('2,5 M€');
  });

  it('keeps small compact amounts fully readable', () => {
    expect(formatMoneyMinor(999900, 'EUR', { compact: true })).toBe('9 999,00 €');
  });
});

describe('formatPct', () => {
  it('signs positive variations', () => {
    expect(formatPct(12.5)).toContain('+12,5');
  });

  it('keeps negative sign', () => {
    expect(formatPct(-8)).toContain('-8');
  });

  it('renders null as an em-dash, never a fake 0%', () => {
    expect(formatPct(null)).toBe('—');
    expect(formatPct(undefined)).toBe('—');
    expect(formatPct(Number.NaN)).toBe('—');
  });
});
