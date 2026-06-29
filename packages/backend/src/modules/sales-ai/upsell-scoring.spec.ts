import {
  coOccurrenceScore,
  marginPercentOf,
  marginScoreOf,
  stockPressureScore,
  stockPressureLabel,
  temporalScore,
  consistencyScore,
  upsellConfidence,
  estimatedCashImpact,
  W_COOCCURRENCE,
  W_MARGIN,
  W_STOCK_PRESSURE,
  W_TEMPORAL,
  W_CONSISTENCY,
} from './upsell-scoring';

describe('POS sales-ai upsell-scoring', () => {
  it('weights sum to 1', () => {
    expect(W_COOCCURRENCE + W_MARGIN + W_STOCK_PRESSURE + W_TEMPORAL + W_CONSISTENCY).toBeCloseTo(1);
  });

  describe('coOccurrenceScore', () => {
    it('caps at 1', () => {
      expect(coOccurrenceScore(1, 1000)).toBe(1);
    });
    it('blends rate + volume', () => {
      // (0.5/0.5)*0.6 + (100/200)*0.4 = 0.6 + 0.2 = 0.8
      expect(coOccurrenceScore(0.5, 100)).toBeCloseTo(0.8);
    });
  });

  describe('marginPercentOf / marginScoreOf', () => {
    it('computes margin %', () => {
      expect(marginPercentOf(200, 50)).toBe(75);
    });
    it('defaults to 50 when price 0', () => {
      expect(marginPercentOf(0, 10)).toBe(50);
    });
    it('margin score caps at 1 (70%)', () => {
      expect(marginScoreOf(70)).toBe(1);
      expect(marginScoreOf(35)).toBe(0.5);
    });
  });

  describe('stock pressure', () => {
    it('score bands', () => {
      expect(stockPressureScore(50)).toBe(1.0);
      expect(stockPressureScore(20)).toBe(0.7);
      expect(stockPressureScore(5)).toBe(0.3);
    });
    it('label bands', () => {
      expect(stockPressureLabel(50)).toBe('overstock');
      expect(stockPressureLabel(20)).toBe('healthy');
      expect(stockPressureLabel(5)).toBe('low');
    });
  });

  describe('temporalScore', () => {
    it('windows', () => {
      expect(temporalScore(13)).toBe(0.9); // lunch
      expect(temporalScore(8)).toBe(0.8); // breakfast
      expect(temporalScore(18)).toBe(0.7); // evening
      expect(temporalScore(3)).toBe(0.5); // off-peak
    });
  });

  describe('consistencyScore', () => {
    it('caps at 1 (30)', () => {
      expect(consistencyScore(30)).toBe(1);
      expect(consistencyScore(15)).toBe(0.5);
    });
  });

  describe('upsellConfidence', () => {
    it('all-max → 1', () => {
      expect(
        upsellConfidence({ coOccurrence: 1, margin: 1, stockPressure: 1, temporal: 1, consistency: 1 }),
      ).toBeCloseTo(1);
    });
  });

  describe('estimatedCashImpact', () => {
    it('rounds margin in cents', () => {
      expect(estimatedCashImpact(75, 200)).toBe(150);
      expect(estimatedCashImpact(33, 100)).toBe(33);
    });
  });
});
