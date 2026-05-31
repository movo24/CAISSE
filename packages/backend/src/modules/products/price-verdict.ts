/**
 * Price verdict engine (pure, side-effect-free).
 *
 * Given two consecutive price periods for a product, judge whether the price
 * change was favourable, unfavourable, or neutral — using MARGIN PER DAY as the
 * decision metric (it combines price, cost and volume in one cash signal).
 *
 * Revenue/day alone is misleading: a higher price with lower volume can keep
 * revenue flat while margin improves (good) or while margin collapses (bad).
 * Only margin/day captures the real outcome.
 *
 * This module is intentionally dependency-free so it can be unit-tested in
 * isolation and reused by the future margin-anomaly module.
 */

export type PriceVerdictKind =
  | 'favorable' // margin/day improved meaningfully
  | 'unfavorable' // margin/day dropped meaningfully
  | 'neutral' // margin/day roughly unchanged
  | 'no_price_change' // price barely moved — comparison not meaningful
  | 'insufficient_data'; // cost unknown OR sample too small to judge margin

export type PriceVerdictReliability = 'ok' | 'low' | 'no_cost';

export interface PriceVerdictPeriod {
  priceMinorUnits: number;
  /** average units sold per day in the period */
  unitsPerDay: number;
  /** average margin per day in cents, or null when cost is unknown */
  marginPerDayMinorUnits: number | null;
  /** number of days the period spans */
  daysDuration: number;
  /** total units sold in the period */
  unitsSold: number;
}

export interface PriceVerdict {
  verdict: PriceVerdictKind;
  /** human-readable French summary for the cashier / manager UI */
  label: string;
  priceDeltaPct: number | null;
  /** delta of units/day vs previous period */
  volumeDeltaPct: number | null;
  /** delta of margin/day vs previous period — the decision metric */
  marginPerDayDeltaPct: number | null;
  reliability: PriceVerdictReliability;
}

// ── Tunable thresholds ──────────────────────────────────────────────────────
/** Below this absolute price move (%), we treat the price as unchanged. */
const NEUTRAL_PRICE_DELTA_PCT = 0.5;
/** Margin/day move beyond ±this (%) is considered meaningful. */
const SIGNIFICANT_MARGIN_DELTA_PCT = 3;
/** A period shorter than this (days) is too short to judge reliably. */
const MIN_RELIABLE_DAYS = 3;
/** A period with fewer units sold than this is too thin to judge reliably. */
const MIN_RELIABLE_UNITS = 10;

function pctDelta(current: number, previous: number): number | null {
  if (previous === 0) return null;
  return Math.round(((current - previous) / previous) * 10000) / 100;
}

function fmtPct(v: number): string {
  const sign = v > 0 ? '+' : '';
  return `${sign}${v.toFixed(1)}%`;
}

/**
 * Compare a period against the one that preceded it and return a verdict.
 * `previous` is the older period, `current` the newer (post-change) period.
 */
export function computePriceVerdict(
  previous: PriceVerdictPeriod,
  current: PriceVerdictPeriod,
): PriceVerdict {
  const priceDeltaPct = pctDelta(current.priceMinorUnits, previous.priceMinorUnits);
  const volumeDeltaPct = pctDelta(current.unitsPerDay, previous.unitsPerDay);

  // Cost unknown for either period → we cannot judge margin at all.
  if (
    current.marginPerDayMinorUnits === null ||
    previous.marginPerDayMinorUnits === null
  ) {
    return {
      verdict: 'insufficient_data',
      label: 'Marge non calculable : coût produit manquant.',
      priceDeltaPct,
      volumeDeltaPct,
      marginPerDayDeltaPct: null,
      reliability: 'no_cost',
    };
  }

  const marginPerDayDeltaPct = pctDelta(
    current.marginPerDayMinorUnits,
    previous.marginPerDayMinorUnits,
  );

  // Price barely moved → the comparison is not a price decision.
  if (priceDeltaPct !== null && Math.abs(priceDeltaPct) < NEUTRAL_PRICE_DELTA_PCT) {
    return {
      verdict: 'no_price_change',
      label: 'Pas de changement de prix significatif sur cette période.',
      priceDeltaPct,
      volumeDeltaPct,
      marginPerDayDeltaPct,
      reliability: 'ok',
    };
  }

  // Sample too small → still give a verdict but flag it as tentative.
  const reliability: PriceVerdictReliability =
    current.daysDuration < MIN_RELIABLE_DAYS ||
    current.unitsSold < MIN_RELIABLE_UNITS ||
    previous.daysDuration < MIN_RELIABLE_DAYS ||
    previous.unitsSold < MIN_RELIABLE_UNITS
      ? 'low'
      : 'ok';

  const priceDir =
    priceDeltaPct !== null && priceDeltaPct > 0 ? 'Hausse' : 'Baisse';
  const tentative = reliability === 'low' ? ' (échantillon faible — à confirmer)' : '';

  if (marginPerDayDeltaPct === null) {
    return {
      verdict: 'insufficient_data',
      label: 'Marge non calculable : marge précédente nulle.',
      priceDeltaPct,
      volumeDeltaPct,
      marginPerDayDeltaPct,
      reliability: 'no_cost',
    };
  }

  const volumeNote =
    volumeDeltaPct !== null ? ` Volume ${fmtPct(volumeDeltaPct)}/jour.` : '';

  if (marginPerDayDeltaPct >= SIGNIFICANT_MARGIN_DELTA_PCT) {
    return {
      verdict: 'favorable',
      label: `${priceDir} de prix validée : marge/jour ${fmtPct(marginPerDayDeltaPct)}.${volumeNote}${tentative}`,
      priceDeltaPct,
      volumeDeltaPct,
      marginPerDayDeltaPct,
      reliability,
    };
  }

  if (marginPerDayDeltaPct <= -SIGNIFICANT_MARGIN_DELTA_PCT) {
    return {
      verdict: 'unfavorable',
      label: `${priceDir} de prix défavorable : marge/jour ${fmtPct(marginPerDayDeltaPct)}.${volumeNote}${tentative}`,
      priceDeltaPct,
      volumeDeltaPct,
      marginPerDayDeltaPct,
      reliability,
    };
  }

  return {
    verdict: 'neutral',
    label: `${priceDir} de prix neutre : marge/jour stable (${fmtPct(marginPerDayDeltaPct)}).${volumeNote}${tentative}`,
    priceDeltaPct,
    volumeDeltaPct,
    marginPerDayDeltaPct,
    reliability,
  };
}
