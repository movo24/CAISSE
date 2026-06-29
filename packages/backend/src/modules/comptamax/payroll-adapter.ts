/**
 * TimeWin24 payroll feed → EmployeePeriodInput[] (pure, unit-testable, defensive).
 *
 * The TW24 payroll feed is `any` (shape varies). This normalizes it into the input
 * the social pre-accounting summary consumes, tolerating common field names and
 * hours-or-minutes encodings. Unknown / malformed → [] (never throws).
 *
 * Gross pay is only carried when the feed provides it in MINOR units
 * (`grossPayMinorUnits` / `grossMinorUnits`) to avoid unit ambiguity.
 */
import type { EmployeePeriodInput } from './social-preaccounting';

function pick(obj: any, keys: string[]): unknown {
  for (const k of keys) if (obj && obj[k] != null) return obj[k];
  return null;
}

function asArray(raw: any): any[] {
  if (Array.isArray(raw)) return raw;
  if (Array.isArray(raw?.employees)) return raw.employees;
  if (Array.isArray(raw?.data)) return raw.data;
  if (Array.isArray(raw?.payroll)) return raw.payroll;
  return [];
}

/** minutes from an explicit minutes field, else hours×60, else 0. */
function toMinutes(minutesVal: unknown, hoursVal: unknown): number {
  const m = Number(minutesVal);
  if (Number.isFinite(m) && minutesVal != null) return Math.round(m);
  const h = Number(hoursVal);
  if (Number.isFinite(h) && hoursVal != null) return Math.round(h * 60);
  return 0;
}

export function toEmployeePeriodInputs(raw: unknown): EmployeePeriodInput[] {
  return asArray(raw)
    .map((item): EmployeePeriodInput | null => {
      const employeeId = pick(item, ['employeeId', 'employee_id', 'id', 'empId']);
      if (employeeId == null) return null;
      const grossMinor = pick(item, ['grossPayMinorUnits', 'grossMinorUnits']);
      return {
        employeeId: String(employeeId),
        employeeName: (pick(item, ['employeeName', 'name', 'fullName']) as string) ?? null,
        workedMinutes: toMinutes(
          pick(item, ['workedMinutes', 'minutesWorked']),
          pick(item, ['workedHours', 'hours', 'hoursWorked']),
        ),
        absenceMinutes: toMinutes(
          pick(item, ['absenceMinutes']),
          pick(item, ['absenceHours', 'absences']),
        ),
        lateMinutes: Number(pick(item, ['lateMinutes', 'retardMinutes'])) || 0,
        grossPayMinorUnits: grossMinor != null ? Number(grossMinor) : null,
      };
    })
    .filter((i): i is EmployeePeriodInput => i !== null);
}
