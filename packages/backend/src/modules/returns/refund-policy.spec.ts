import {
  isValidRefundMethod,
  creditNoteRefundState,
  isSpendableStoreCredit,
  REFUND_METHODS,
} from './refund-policy';

describe('POS returns refund-policy', () => {
  describe('isValidRefundMethod', () => {
    it('accepts the three methods', () => {
      expect(REFUND_METHODS).toEqual(['cash', 'card', 'store_credit']);
      expect(isValidRefundMethod('cash')).toBe(true);
      expect(isValidRefundMethod('store_credit')).toBe(true);
    });
    it('rejects others', () => {
      expect(isValidRefundMethod('paypal')).toBe(false);
      expect(isValidRefundMethod('')).toBe(false);
    });
  });

  describe('creditNoteRefundState', () => {
    it('store_credit → active spendable balance', () => {
      expect(creditNoteRefundState('store_credit', 1500)).toEqual({
        type: 'store_credit',
        refundMethod: null,
        status: 'active',
        remainingMinorUnits: 1500,
      });
    });
    it('cash/card → immediate refund, no balance', () => {
      expect(creditNoteRefundState('cash', 1500)).toEqual({
        type: 'refund',
        refundMethod: 'cash',
        status: 'refunded',
        remainingMinorUnits: 0,
      });
    });
  });

  describe('isSpendableStoreCredit', () => {
    it('active/partially_redeemed with balance', () => {
      expect(isSpendableStoreCredit('store_credit', 'active', 100)).toBe(true);
      expect(isSpendableStoreCredit('store_credit', 'partially_redeemed', 50)).toBe(true);
    });
    it('not spendable when wrong type/status/empty', () => {
      expect(isSpendableStoreCredit('refund', 'active', 100)).toBe(false);
      expect(isSpendableStoreCredit('store_credit', 'redeemed', 100)).toBe(false);
      expect(isSpendableStoreCredit('store_credit', 'active', 0)).toBe(false);
    });
  });
});
