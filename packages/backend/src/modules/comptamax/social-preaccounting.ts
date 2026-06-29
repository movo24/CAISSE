/**
 * TimeWin24 → Comptamax24 — social pre-accounting PREP (pure, unit-testable).
 *
 * Prepares the HR variables (worked hours, absences, lateness) needed to build
 * social payroll entries — as a structured, auditable summary + CSV justificatif.
 *
 * IMPORTANT (gate): this does NOT post real payroll/social journal entries
 * (comptes 641/645/431…). Those require a validated payroll chart + product/
 * accounting decision (TD-INT-SOCIAL-ENTRIES). Here we only consolidate the
 * inputs so an accountant / Comptamax24 can produce the entries.
 */

import { csvSafeCell } from '../../common/csv/csv-safe';

export interface EmployeePeriodInput {
  employeeId: string;
  employeeName?: string | null;
  workedMinutes: number;
  absenceMinutes?: number;
  lateMinutes?: number;
  grossPayMinorUnits?: number | null; // optional if TW24 provides it
}

export interface EmployeePeriodRow {
  employeeId: string;
  employeeName: string;
  workedHours: number; // 2 decimals
  absenceHours: number;
  lateMinutes: number;
  grossPayMinorUnits: number | null;
}

export interface WorkforcePeriodSummary {
  period: string;
  storeId: string;
  headcount: number;
  totalWorkedHours: number;
  totalAbsenceHours: number;
  totalLateMinutes: number;
  totalGrossPayMinorUnits: number | null; // null when no gross provided
  rows: EmployeePeriodRow[];
}

/** Minutes → hours, 2 decimals. */
export function minutesToHours(min: number): number {
  return Math.round((min / 60) * 100) / 100;
}

/** Consolidate per-employee HR variables for a payroll period (one store). */
export function summarizeWorkforcePeriod(input: {
  period: string;
  storeId: string;
  employees: EmployeePeriodInput[];
}): WorkforcePeriodSummary {
  const rows: EmployeePeriodRow[] = input.employees.map((e) => ({
    employeeId: e.employeeId,
    employeeName: e.employeeName ?? e.employeeId,
    workedHours: minutesToHours(e.workedMinutes),
    absenceHours: minutesToHours(e.absenceMinutes ?? 0),
    lateMinutes: e.lateMinutes ?? 0,
    grossPayMinorUnits: e.grossPayMinorUnits ?? null,
  }));

  const totalGross = input.employees.reduce<number | null>((acc, e) => {
    if (e.grossPayMinorUnits == null) return acc;
    return (acc ?? 0) + e.grossPayMinorUnits;
  }, null);

  return {
    period: input.period,
    storeId: input.storeId,
    headcount: rows.length,
    totalWorkedHours: minutesToHours(input.employees.reduce((a, e) => a + e.workedMinutes, 0)),
    totalAbsenceHours: minutesToHours(input.employees.reduce((a, e) => a + (e.absenceMinutes ?? 0), 0)),
    totalLateMinutes: input.employees.reduce((a, e) => a + (e.lateMinutes ?? 0), 0),
    totalGrossPayMinorUnits: totalGross,
    rows,
  };
}

/** CSV justificatif (employe;heures;absences_h;retard_min;brut). */
export function workforceToCsv(summary: WorkforcePeriodSummary): string {
  const money = (c: number | null) => (c == null ? '' : (c / 100).toFixed(2).replace('.', ','));
  const header = 'employe_id;employe;heures_travaillees;heures_absence;retard_min;brut';
  // POS-INT-113 — guard free-text fields (employeeId, employeeName) against CSV
  // formula injection; numeric/money fields are digit-leading and emitted raw.
  const rows = summary.rows.map(
    (r) =>
      `${csvSafeCell(r.employeeId)};${csvSafeCell(r.employeeName)};${r.workedHours.toFixed(2).replace('.', ',')};` +
      `${r.absenceHours.toFixed(2).replace('.', ',')};${r.lateMinutes};${money(r.grossPayMinorUnits)}`,
  );
  return [header, ...rows].join('\n');
}
