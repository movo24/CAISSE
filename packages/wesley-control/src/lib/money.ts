/**
 * Money display — amounts arrive from the API as integer minor units
 * (centimes). No float arithmetic on amounts: we only split int/decimal parts
 * for display.
 */
export function formatMoneyMinor(
  minorUnits: number,
  currency = 'EUR',
  opts: { compact?: boolean } = {},
): string {
  const sign = minorUnits < 0 ? '-' : '';
  const abs = Math.abs(Math.round(minorUnits));
  const euros = Math.floor(abs / 100);
  const cents = abs % 100;

  if (opts.compact && euros >= 10000) {
    const k = euros / 1000;
    const kStr = (
      k >= 1000
        ? `${(k / 1000).toFixed(k % 1000 === 0 ? 0 : 1)} M`
        : `${k.toFixed(k % 1 === 0 ? 0 : 1)} k`
    ).replace('.', ',');
    return `${sign}${kStr}${symbol(currency)}`;
  }

  const eurosStr = euros.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  const centsStr = cents.toString().padStart(2, '0');
  return `${sign}${eurosStr},${centsStr} ${symbol(currency)}`;
}

function symbol(currency: string): string {
  switch (currency) {
    case 'EUR':
      return '€';
    case 'USD':
      return '$';
    case 'GBP':
      return '£';
    default:
      return currency;
  }
}

/** Signed percentage for display; null → em-dash (never a fake 0%). */
export function formatPct(pct: number | null | undefined): string {
  if (pct === null || pct === undefined || !Number.isFinite(pct)) return '—';
  const sign = pct > 0 ? '+' : '';
  return `${sign}${pct.toLocaleString('fr-FR', { maximumFractionDigits: 1 })} %`;
}
