import { rate, scoreRecommendation } from './reco-scoring';

describe('POS sales-ai reco-scoring', () => {
  describe('rate', () => {
    it('safe division', () => {
      expect(rate(5, 10)).toBe(0.5);
      expect(rate(3, 0)).toBe(0);
    });
  });

  describe('scoreRecommendation', () => {
    it('neutral below min displays (no judgement)', () => {
      expect(scoreRecommendation(19, 0, 0)).toEqual({
        performanceScore: 0.5,
        status: 'active',
      });
    });
    it('blacklist when CTR < 3% with enough displays', () => {
      expect(scoreRecommendation(20, 0.02, 0)).toEqual({
        performanceScore: 0.0,
        status: 'blacklisted',
      });
    });
    it('penalize when CTR in [3%,5%)', () => {
      expect(scoreRecommendation(50, 0.04, 0)).toEqual({
        performanceScore: 0.2,
        status: 'penalized',
      });
    });
    it('boost when conversion >= 10%', () => {
      expect(scoreRecommendation(50, 0.06, 0.12)).toEqual({
        performanceScore: 1.0,
        status: 'active',
      });
    });
    it('graded score otherwise (capped at 1)', () => {
      // ctr 0.06, conv 0.05 → 0.06*5 + 0.05*3 = 0.45
      expect(scoreRecommendation(50, 0.06, 0.05)).toEqual({
        performanceScore: 0.45,
        status: 'active',
      });
      // high ctr caps at 1
      expect(scoreRecommendation(50, 0.5, 0.05).performanceScore).toBe(1);
    });
  });
});
