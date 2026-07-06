/**
 * Period (date-range) analytics — PURE aggregation (no DB, unit-testable).
 *
 * This is a READ-ONLY analytical layer over the sales table. It does NOT touch,
 * replace, or reinterpret the daily Z-report (the sealed fiscal close). It
 * simply aggregates completed sales over an inclusive [startDate, endDate]
 * range, bucketing each sale by its LOCAL date in the store timezone
 * (default Europe/Paris), and returns period totals + a per-day breakdown.
 *
 * Business rules honoured:
 *  - period is inclusive: startDate 00:00:00 → endDate 23:59:59 (store tz);
 *  - average basket is NEVER an average of daily averages — it is
 *    totalRevenue / totalTransactions over the whole period;
 *  - voided tickets are excluded from revenue (only completed sales count),
 *    exactly like the daily aggregation; they are reported separately;
 *  - days with no sales are included with zero values.
 */

export const DEFAULT_TIMEZONE = 'Europe/Paris';

/** Hard cap so a pathological range can never fan out unbounded. */
export const MAX_RANGE_DAYS = 366;

export interface RawPayment {
  method: string;
  amountMinorUnits: number;
}

export interface RawSale {
  createdAt: Date | string;
  totalMinorUnits: number;
  taxTotalMinorUnits: number;
  discountTotalMinorUnits: number;
  payments: RawPayment[];
}

export interface RawVoided {
  createdAt: Date | string;
  totalMinorUnits: number;
}

export interface PeriodDay {
  date: string;
  totalRevenueMinorUnits: number;
  transactionCount: number;
  averageBasketMinorUnits: number;
  totalTaxMinorUnits: number;
  cardTotalMinorUnits: number;
  cashTotalMinorUnits: number;
  discountTotalMinorUnits: number;
  voidCount: number;
}

export interface PaymentBreakdownEntry {
  method: string;
  amountMinorUnits: number;
}

export interface PeriodSummary {
  startDate: string;
  endDate: string;
  timeZone: string;
  dayCount: number;
  isSingleDay: boolean;
  totalRevenueMinorUnits: number;
  transactionCount: number;
  averageBasketMinorUnits: number;
  totalTaxMinorUnits: number;
  cardTotalMinorUnits: number;
  cashTotalMinorUnits: number;
  otherPaymentsMinorUnits: number;
  discountTotalMinorUnits: number;
  voidCount: number;
  voidedAmountMinorUnits: number;
  paymentBreakdown: PaymentBreakdownEntry[];
  peakHours: Array<{ hour: number; transactionCount: number }>;
  days: PeriodDay[];
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** True for a syntactically- and calendar-valid YYYY-MM-DD string. */
export function isValidDateString(s: string): boolean {
  if (typeof s !== 'string' || !DATE_RE.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/**
 * Inclusive list of dates from startDate to endDate (YYYY-MM-DD).
 * Throws on invalid format, endDate < startDate, or a range beyond MAX_RANGE_DAYS.
 */
export function enumerateDates(startDate: string, endDate: string): string[] {
  if (!isValidDateString(startDate)) throw new Error(`Date de début invalide : ${startDate}`);
  if (!isValidDateString(endDate)) throw new Error(`Date de fin invalide : ${endDate}`);
  const start = Date.parse(`${startDate}T00:00:00Z`);
  const end = Date.parse(`${endDate}T00:00:00Z`);
  if (end < start) {
    throw new Error('La date de fin ne peut pas être antérieure à la date de début.');
  }
  const days: string[] = [];
  for (let t = start; t <= end; t += 86_400_000) {
    days.push(new Date(t).toISOString().slice(0, 10));
    if (days.length > MAX_RANGE_DAYS) {
      throw new Error(`Période trop longue (max ${MAX_RANGE_DAYS} jours).`);
    }
  }
  return days;
}

/** The calendar date (YYYY-MM-DD) of an instant in the given timezone. */
export function dayInTimeZone(instant: Date | string, timeZone: string): string {
  const d = instant instanceof Date ? instant : new Date(instant);
  // en-CA renders as YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

/** The hour (0–23) of an instant in the given timezone. */
export function hourInTimeZone(instant: Date | string, timeZone: string): number {
  const d = instant instanceof Date ? instant : new Date(instant);
  const h = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    hour12: false,
  }).format(d);
  const n = parseInt(h, 10);
  return Number.isFinite(n) ? n % 24 : 0;
}

/**
 * UTC instant bounds for the inclusive local range [startDate 00:00,
 * endDate 24:00) in `timeZone`. Used to build a DB WHERE clause that captures
 * exactly the sales whose local date falls in the range. The exact per-day
 * bucketing is still done by `dayInTimeZone` so DST edges are handled per-sale.
 */
export function zonedRangeToUtc(
  startDate: string,
  endDate: string,
  timeZone: string,
): { gte: Date; lt: Date } {
  const dayAfterEnd = new Date(Date.parse(`${endDate}T00:00:00Z`) + 86_400_000)
    .toISOString()
    .slice(0, 10);
  return {
    gte: zonedTimeToUtc(startDate, '00:00:00', timeZone),
    lt: zonedTimeToUtc(dayAfterEnd, '00:00:00', timeZone),
  };
}

/** Offset (ms) that `timeZone` is ahead of UTC at the given instant. */
function tzOffsetMs(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
    .formatToParts(instant)
    .reduce<Record<string, string>>((acc, p) => {
      acc[p.type] = p.value;
      return acc;
    }, {});
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );
  return asUtc - instant.getTime();
}

/** Convert a wall-clock time in `timeZone` to the corresponding UTC instant. */
export function zonedTimeToUtc(dateStr: string, timeStr: string, timeZone: string): Date {
  const naive = Date.parse(`${dateStr}T${timeStr}Z`); // interpret as if UTC
  const offset = tzOffsetMs(new Date(naive), timeZone);
  return new Date(naive - offset);
}

export interface AggregatePeriodInput {
  completed: RawSale[];
  voided: RawVoided[];
  startDate: string;
  endDate: string;
  timeZone?: string;
}

function emptyDay(date: string): PeriodDay {
  return {
    date,
    totalRevenueMinorUnits: 0,
    transactionCount: 0,
    averageBasketMinorUnits: 0,
    totalTaxMinorUnits: 0,
    cardTotalMinorUnits: 0,
    cashTotalMinorUnits: 0,
    discountTotalMinorUnits: 0,
    voidCount: 0,
  };
}

/**
 * Aggregate completed + voided sales into a period summary. Pure and
 * deterministic given the inputs (timezone handling via Intl).
 */
export function aggregatePeriod(input: AggregatePeriodInput): PeriodSummary {
  const timeZone = input.timeZone || DEFAULT_TIMEZONE;
  const dates = enumerateDates(input.startDate, input.endDate);
  const dateSet = new Set(dates);
  const dayMap = new Map<string, PeriodDay>(dates.map((d) => [d, emptyDay(d)]));

  const paymentTotals = new Map<string, number>();
  const hourCounts = new Map<number, number>();

  let totalRevenue = 0;
  let totalTax = 0;
  let totalDiscount = 0;
  let cardTotal = 0;
  let cashTotal = 0;
  let transactionCount = 0;

  for (const sale of input.completed) {
    const day = dayInTimeZone(sale.createdAt, timeZone);
    if (!dateSet.has(day)) continue; // outside the local range (padding safety)
    const bucket = dayMap.get(day)!;

    const revenue = Math.round(sale.totalMinorUnits || 0);
    const tax = Math.round(sale.taxTotalMinorUnits || 0);
    const discount = Math.round(sale.discountTotalMinorUnits || 0);

    bucket.totalRevenueMinorUnits += revenue;
    bucket.totalTaxMinorUnits += tax;
    bucket.discountTotalMinorUnits += discount;
    bucket.transactionCount += 1;

    totalRevenue += revenue;
    totalTax += tax;
    totalDiscount += discount;
    transactionCount += 1;

    for (const p of sale.payments || []) {
      const amt = Math.round(p.amountMinorUnits || 0);
      paymentTotals.set(p.method, (paymentTotals.get(p.method) || 0) + amt);
      if (p.method === 'card') {
        cardTotal += amt;
        bucket.cardTotalMinorUnits += amt;
      } else if (p.method === 'cash') {
        cashTotal += amt;
        bucket.cashTotalMinorUnits += amt;
      }
    }

    const hour = hourInTimeZone(sale.createdAt, timeZone);
    hourCounts.set(hour, (hourCounts.get(hour) || 0) + 1);
  }

  let voidCount = 0;
  let voidedAmount = 0;
  for (const v of input.voided) {
    const day = dayInTimeZone(v.createdAt, timeZone);
    if (!dateSet.has(day)) continue;
    dayMap.get(day)!.voidCount += 1;
    voidCount += 1;
    voidedAmount += Math.round(v.totalMinorUnits || 0);
  }

  // Per-day average baskets (each day: its own revenue / its own tx).
  const days = dates.map((d) => {
    const b = dayMap.get(d)!;
    b.averageBasketMinorUnits = b.transactionCount > 0 ? Math.round(b.totalRevenueMinorUnits / b.transactionCount) : 0;
    return b;
  });

  // Period average basket = total revenue / total transactions (NOT avg of avgs).
  const averageBasket = transactionCount > 0 ? Math.round(totalRevenue / transactionCount) : 0;

  const paymentBreakdown = Array.from(paymentTotals.entries())
    .map(([method, amountMinorUnits]) => ({ method, amountMinorUnits }))
    .sort((a, b) => b.amountMinorUnits - a.amountMinorUnits);

  const otherPayments = paymentBreakdown
    .filter((p) => p.method !== 'card' && p.method !== 'cash')
    .reduce((s, p) => s + p.amountMinorUnits, 0);

  const peakHours = Array.from(hourCounts.entries())
    .map(([hour, transactionCount2]) => ({ hour, transactionCount: transactionCount2 }))
    .sort((a, b) => b.transactionCount - a.transactionCount);

  return {
    startDate: input.startDate,
    endDate: input.endDate,
    timeZone,
    dayCount: dates.length,
    isSingleDay: dates.length === 1,
    totalRevenueMinorUnits: totalRevenue,
    transactionCount,
    averageBasketMinorUnits: averageBasket,
    totalTaxMinorUnits: totalTax,
    cardTotalMinorUnits: cardTotal,
    cashTotalMinorUnits: cashTotal,
    otherPaymentsMinorUnits: otherPayments,
    discountTotalMinorUnits: totalDiscount,
    voidCount,
    voidedAmountMinorUnits: voidedAmount,
    paymentBreakdown,
    peakHours,
    days,
  };
}
