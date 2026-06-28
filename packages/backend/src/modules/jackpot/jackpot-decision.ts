/**
 * Jackpot lottery decision (pure, deterministic with injected rolls → unit-testable).
 * Extracted from JackpotService.rollLottery (behavior-preserving).
 *
 * Decision tree:
 *  1. inactive → no_win
 *  2. MEGA: mega quota available AND liveCount >= density threshold AND megaRoll < megaProb → mega_jackpot
 *  3. SMALL: small quota available AND smallRoll < smallProb → small_win
 *  4. else → no_win
 * Rolls are 0-100. Probabilities are percentages (0-100).
 */
export type JackpotResultType = 'mega_jackpot' | 'small_win' | 'no_win';

export interface JackpotDecisionInput {
  active: boolean;
  liveCount: number;
  densityThresholdForMega: number;
  megaQuotaPerDay: number;
  megaWonToday: number;
  megaProbabilityPercent: number;
  smallWinQuotaPerDay: number;
  smallWonToday: number;
  smallWinProbabilityPercent: number;
  megaRoll: number;
  smallRoll: number;
}

export function decideJackpotOutcome(i: JackpotDecisionInput): JackpotResultType {
  if (!i.active) return 'no_win';

  const megaQuotaAvailable = i.megaWonToday < i.megaQuotaPerDay;
  const densityMet = i.liveCount >= i.densityThresholdForMega;
  if (megaQuotaAvailable && densityMet && i.megaRoll < i.megaProbabilityPercent) {
    return 'mega_jackpot';
  }

  const smallQuotaAvailable = i.smallWonToday < i.smallWinQuotaPerDay;
  if (smallQuotaAvailable && i.smallRoll < i.smallWinProbabilityPercent) {
    return 'small_win';
  }

  return 'no_win';
}
