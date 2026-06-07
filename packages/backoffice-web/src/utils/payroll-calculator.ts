/* ═══════════════════════════════════════════════════════════════
   PAYROLL CALCULATOR — shared shape + formatters for payroll export.

   NOTE: payroll COMPUTATION is owned by TimeWin24 (the HR source of truth).
   This module only defines the data contract consumed by the export/print
   helpers in `export-utils.ts` and provides pure FR-locale formatters.
   ═══════════════════════════════════════════════════════════════ */

/** A single employee's payroll summary for one month (all money amounts in cents). */
export interface MonthPayroll {
  employeeName: string;
  role: string;
  /** ISO month, e.g. "2026-06". */
  month: string;
  daysWorked: number;
  totalWorkedHours: number;
  regularHours: number;
  overtimeHours25: number;
  overtimeHours50: number;
  /** Gross amounts in cents. */
  grossRegular: number;
  grossOvertime25: number;
  grossOvertime50: number;
  grossTotal: number;
  employeeSocialCharges: number;
  netBeforeTax: number;
  employerSocialCharges: number;
}

/** Format an amount in cents as a French-locale currency string, e.g. "1 234,50 €". */
export function formatCurrency(cents: number): string {
  return (
    (cents / 100).toLocaleString('fr-FR', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }) + ' €'
  );
}

/** Format a decimal hours value as "7h" or "7h30". */
export function formatHours(hours: number): string {
  const whole = Math.floor(hours);
  const minutes = Math.round((hours - whole) * 60);
  return minutes > 0 ? `${whole}h${String(minutes).padStart(2, '0')}` : `${whole}h`;
}
