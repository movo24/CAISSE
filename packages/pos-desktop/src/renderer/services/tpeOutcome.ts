/**
 * Pure decision for a TPE (card terminal) result — no React, no I/O, unit-testable.
 *
 * M601: the card-success branch finalizes the sale ONLY on a confirmed `'success'`
 * with a live waiting context. `'refused'` / `'timeout'` (or a missing context) NEVER
 * finalize — the cashier retries or switches tender. This upholds decision-6 ("no
 * 'paid' without a real capture"): a `'success'` is the cashier's explicit confirmation
 * that the standalone terminal approved (or, for an integrated reader, a real capture
 * event). The UI is what triggers `'success'`/`'refused'`; this function only decides
 * what that result MEANS, so the decision is testable independent of React.
 */
export type TpeResult = 'success' | 'refused' | 'timeout';
export type TpeContext = 'quick' | 'split';

export interface TpeOutcome {
  /** Commit/finalize the card leg — true ONLY on a confirmed success with a live context. */
  finalizesSale: boolean;
  /** 'quick' = whole ticket as one card tender; 'split' = partial card tender; null when not finalizing. */
  mode: TpeContext | null;
}

export function decideTpeOutcome(
  result: TpeResult,
  context: TpeContext | null | undefined,
): TpeOutcome {
  if (result === 'success' && (context === 'quick' || context === 'split')) {
    return { finalizesSale: true, mode: context };
  }
  return { finalizesSale: false, mode: null };
}
