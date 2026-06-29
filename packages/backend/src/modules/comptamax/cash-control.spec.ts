import { reconcileCashControl, tenderBucket, cashControlToCsv } from './cash-control';

describe('cash-control / écart de caisse (POS-INT-110)', () => {
  describe('tenderBucket', () => {
    it('maps methods to buckets', () => {
      expect(tenderBucket('cash')).toBe('cash');
      expect(tenderBucket('card')).toBe('card');
      expect(tenderBucket('stripe_terminal')).toBe('card');
      expect(tenderBucket('store_credit')).toBe('other');
      expect(tenderBucket('voucher')).toBe('other');
    });
  });

  it('balanced when captured matches the Z-report', () => {
    const r = reconcileCashControl(
      [
        { method: 'cash', amountMinorUnits: 5000 },
        { method: 'card', amountMinorUnits: 3000 },
        { method: 'stripe_terminal', amountMinorUnits: 2000 },
      ],
      { cashTotalMinorUnits: 5000, cardTotalMinorUnits: 5000 },
    );
    expect(r.balanced).toBe(true);
    expect(r.totalDiffMinorUnits).toBe(0);
    expect(r.byBucket.find((b) => b.bucket === 'card')).toMatchObject({
      capturedMinorUnits: 5000, declaredMinorUnits: 5000, diffMinorUnits: 0,
    });
  });

  it('flags a cash shortage as a negative diff', () => {
    const r = reconcileCashControl(
      [{ method: 'cash', amountMinorUnits: 4900 }],
      { cashTotalMinorUnits: 5000, cardTotalMinorUnits: 0 },
    );
    expect(r.balanced).toBe(false);
    const cash = r.byBucket.find((b) => b.bucket === 'cash')!;
    expect(cash.diffMinorUnits).toBe(-100); // 1€ manquant
  });

  it('surfaces other-bucket tenders with no Z counterpart (no totalRevenue)', () => {
    const r = reconcileCashControl(
      [{ method: 'store_credit', amountMinorUnits: 1500 }],
      { cashTotalMinorUnits: 0, cardTotalMinorUnits: 0 },
    );
    const other = r.byBucket.find((b) => b.bucket === 'other')!;
    expect(other).toMatchObject({ capturedMinorUnits: 1500, declaredMinorUnits: 0, diffMinorUnits: 1500 });
    expect(r.balanced).toBe(false);
  });

  it('balanced when store-credit matches the Z residual (POS-INT-116, no false positive)', () => {
    // Day: 100€ cash + 50€ card + 15€ store credit = 165€ revenue.
    const r = reconcileCashControl(
      [
        { method: 'cash', amountMinorUnits: 10000 },
        { method: 'card', amountMinorUnits: 5000 },
        { method: 'store_credit', amountMinorUnits: 1500 },
      ],
      { cashTotalMinorUnits: 10000, cardTotalMinorUnits: 5000, totalRevenueMinorUnits: 16500 },
    );
    const other = r.byBucket.find((b) => b.bucket === 'other')!;
    expect(other).toMatchObject({ capturedMinorUnits: 1500, declaredMinorUnits: 1500, diffMinorUnits: 0 });
    expect(r.balanced).toBe(true);
  });

  it('still flags an other-bucket shortage against the residual', () => {
    const r = reconcileCashControl(
      [{ method: 'store_credit', amountMinorUnits: 1000 }],
      { cashTotalMinorUnits: 0, cardTotalMinorUnits: 0, totalRevenueMinorUnits: 1500 },
    );
    const other = r.byBucket.find((b) => b.bucket === 'other')!;
    expect(other.diffMinorUnits).toBe(-500); // 5€ d'avoir manquant
    expect(r.balanced).toBe(false);
  });

  it('totals are consistent', () => {
    const r = reconcileCashControl(
      [
        { method: 'cash', amountMinorUnits: 1000 },
        { method: 'card', amountMinorUnits: 2000 },
      ],
      { cashTotalMinorUnits: 1000, cardTotalMinorUnits: 2000 },
    );
    expect(r.totalCapturedMinorUnits).toBe(3000);
    expect(r.totalDeclaredMinorUnits).toBe(3000);
    expect(r.totalDiffMinorUnits).toBe(0);
  });

  describe('cashControlToCsv (POS-INT-112)', () => {
    it('emits a header, one row per bucket and a TOTAL row', () => {
      const r = reconcileCashControl(
        [
          { method: 'cash', amountMinorUnits: 4900 },
          { method: 'card', amountMinorUnits: 2000 },
        ],
        { cashTotalMinorUnits: 5000, cardTotalMinorUnits: 2000 },
      );
      const csv = cashControlToCsv(r).split('\n');
      expect(csv[0]).toBe('bucket,capturedMinorUnits,declaredMinorUnits,diffMinorUnits');
      expect(csv[1]).toBe('cash,4900,5000,-100');
      expect(csv[2]).toBe('card,2000,2000,0');
      expect(csv[3]).toBe('other,0,0,0');
      expect(csv[4]).toBe('TOTAL,6900,7000,-100');
      expect(csv).toHaveLength(5);
    });
  });
});
