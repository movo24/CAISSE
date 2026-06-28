import { decideJackpotOutcome, JackpotDecisionInput } from './jackpot-decision';

const base = (o: Partial<JackpotDecisionInput> = {}): JackpotDecisionInput => ({
  active: true,
  liveCount: 10,
  densityThresholdForMega: 5,
  megaQuotaPerDay: 1,
  megaWonToday: 0,
  megaProbabilityPercent: 2,
  smallWinQuotaPerDay: 10,
  smallWonToday: 0,
  smallWinProbabilityPercent: 20,
  megaRoll: 50,
  smallRoll: 50,
  ...o,
});

describe('jackpot decideJackpotOutcome', () => {
  it('inactive = no_win', () => {
    expect(decideJackpotOutcome(base({ active: false, megaRoll: 0, smallRoll: 0 }))).toBe('no_win');
  });
  it('mega win when quota+density met and roll under prob', () => {
    expect(decideJackpotOutcome(base({ megaRoll: 1 }))).toBe('mega_jackpot');
  });
  it('no mega when density not met (falls through)', () => {
    expect(decideJackpotOutcome(base({ liveCount: 2, megaRoll: 1, smallRoll: 90 }))).toBe('no_win');
  });
  it('no mega when quota exhausted', () => {
    expect(decideJackpotOutcome(base({ megaWonToday: 1, megaRoll: 1, smallRoll: 90 }))).toBe('no_win');
  });
  it('small win when roll under small prob and no mega', () => {
    expect(decideJackpotOutcome(base({ megaRoll: 99, smallRoll: 5 }))).toBe('small_win');
  });
  it('no small win when small quota exhausted', () => {
    expect(decideJackpotOutcome(base({ megaRoll: 99, smallRoll: 5, smallWonToday: 10 }))).toBe('no_win');
  });
  it('mega takes priority over small', () => {
    expect(decideJackpotOutcome(base({ megaRoll: 1, smallRoll: 1 }))).toBe('mega_jackpot');
  });
  it('no win when both rolls above thresholds', () => {
    expect(decideJackpotOutcome(base({ megaRoll: 99, smallRoll: 99 }))).toBe('no_win');
  });
});
