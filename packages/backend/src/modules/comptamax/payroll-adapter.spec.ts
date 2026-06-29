import { toEmployeePeriodInputs } from './payroll-adapter';

describe('Comptamax payroll-adapter', () => {
  it('maps array with minutes + gross minor', () => {
    const r = toEmployeePeriodInputs([
      { employeeId: 'e1', name: 'Alice', workedMinutes: 9600, absenceMinutes: 120, lateMinutes: 15, grossPayMinorUnits: 250000 },
    ]);
    expect(r).toEqual([
      { employeeId: 'e1', employeeName: 'Alice', workedMinutes: 9600, absenceMinutes: 120, lateMinutes: 15, grossPayMinorUnits: 250000 },
    ]);
  });

  it('converts hours → minutes and unwraps {employees}', () => {
    const r = toEmployeePeriodInputs({ employees: [{ id: 'e2', fullName: 'Bob', workedHours: 80, absenceHours: 2 }] });
    expect(r[0]).toMatchObject({ employeeId: 'e2', employeeName: 'Bob', workedMinutes: 4800, absenceMinutes: 120, grossPayMinorUnits: null });
  });

  it('drops items without an employee id; tolerates junk', () => {
    expect(toEmployeePeriodInputs([{ name: 'no id' }, null, 7])).toEqual([]);
    expect(toEmployeePeriodInputs(null)).toEqual([]);
    expect(toEmployeePeriodInputs('nope')).toEqual([]);
  });

  it('defaults missing fields to 0 / null', () => {
    const r = toEmployeePeriodInputs([{ employee_id: 'e3' }]);
    expect(r[0]).toEqual({ employeeId: 'e3', employeeName: null, workedMinutes: 0, absenceMinutes: 0, lateMinutes: 0, grossPayMinorUnits: null });
  });
});
