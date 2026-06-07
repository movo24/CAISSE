import { describe, it, expect } from 'vitest';
import { computePaymentState, isFullyCovered, Tender } from './paymentMachine';

const t = (method: any, amount: number): Tender => ({ method, amountMinorUnits: amount });

describe('computePaymentState', () => {
  it('cash exact → covered, no change', () => {
    const s = computePaymentState(1000, [t('cash', 1000)]);
    expect(s).toEqual({ totalPaid: 1000, remaining: 0, changeDue: 0, forfeitedOverpay: 0, isCovered: true });
  });

  it('cash overpay → change from cash', () => {
    const s = computePaymentState(1000, [t('cash', 1500)]);
    expect(s.isCovered).toBe(true);
    expect(s.changeDue).toBe(500);
    expect(s.forfeitedOverpay).toBe(0);
  });

  it('card exact → covered, no change', () => {
    const s = computePaymentState(1000, [t('card', 1000)]);
    expect(s.changeDue).toBe(0);
    expect(s.isCovered).toBe(true);
  });

  it('under-payment → not covered, remaining owed', () => {
    const s = computePaymentState(1000, [t('cash', 400)]);
    expect(s.isCovered).toBe(false);
    expect(s.remaining).toBe(600);
    expect(s.changeDue).toBe(0);
  });

  it('meal voucher overpay → covered but NO cash change (excess forfeited)', () => {
    const s = computePaymentState(1000, [t('voucher', 1200)]);
    expect(s.isCovered).toBe(true);
    expect(s.changeDue).toBe(0);
    expect(s.forfeitedOverpay).toBe(200);
  });

  it('gift card overpay → no change either (non-cash)', () => {
    const s = computePaymentState(1000, [t('gift_card', 1300)]);
    expect(s.changeDue).toBe(0);
    expect(s.forfeitedOverpay).toBe(300);
  });

  it('voucher + cash: change comes only from the cash part', () => {
    // 7€ voucher + 5€ cash on a 10€ ticket → cash needed = 3€ → change = 2€
    const s = computePaymentState(1000, [t('voucher', 700), t('cash', 500)]);
    expect(s.isCovered).toBe(true);
    expect(s.changeDue).toBe(200);
    expect(s.forfeitedOverpay).toBe(0);
  });

  it('voucher covers more than total + cash added: cash is fully change, voucher excess forfeited', () => {
    // 12€ voucher + 3€ cash on 10€ → non-cash already covers; all 3€ cash is change; 2€ voucher forfeited
    const s = computePaymentState(1000, [t('voucher', 1200), t('cash', 300)]);
    expect(s.isCovered).toBe(true);
    expect(s.changeDue).toBe(300);
    expect(s.forfeitedOverpay).toBe(200);
  });

  it('isFullyCovered reflects coverage', () => {
    expect(isFullyCovered(1000, [t('cash', 1000)])).toBe(true);
    expect(isFullyCovered(1000, [t('cash', 999)])).toBe(false);
  });
});
