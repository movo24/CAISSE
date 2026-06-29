import {
  minutesToHours,
  summarizeWorkforcePeriod,
  workforceToCsv,
} from './social-preaccounting';

describe('Comptamax social pre-accounting prep', () => {
  it('minutesToHours rounds to 2 decimals', () => {
    expect(minutesToHours(90)).toBe(1.5);
    expect(minutesToHours(100)).toBe(1.67);
  });

  const summary = summarizeWorkforcePeriod({
    period: '2026-06',
    storeId: 'store-1',
    employees: [
      { employeeId: 'e1', employeeName: 'Alice', workedMinutes: 9600, absenceMinutes: 120, lateMinutes: 15, grossPayMinorUnits: 250000 },
      { employeeId: 'e2', employeeName: 'Bob', workedMinutes: 4800, absenceMinutes: 0, lateMinutes: 0 },
    ],
  });

  it('consolidates per-employee + totals', () => {
    expect(summary.headcount).toBe(2);
    expect(summary.totalWorkedHours).toBe(240); // (9600+4800)/60
    expect(summary.totalAbsenceHours).toBe(2);
    expect(summary.totalLateMinutes).toBe(15);
    expect(summary.rows[0]).toMatchObject({ employeeId: 'e1', workedHours: 160, absenceHours: 2, lateMinutes: 15, grossPayMinorUnits: 250000 });
    expect(summary.rows[1].grossPayMinorUnits).toBeNull();
  });

  it('totalGross sums only provided gross (partial → counts present)', () => {
    expect(summary.totalGrossPayMinorUnits).toBe(250000);
  });

  it('totalGross is null when no gross provided at all', () => {
    const s = summarizeWorkforcePeriod({
      period: '2026-06', storeId: 'store-1',
      employees: [{ employeeId: 'e3', workedMinutes: 600 }],
    });
    expect(s.totalGrossPayMinorUnits).toBeNull();
  });

  it('csv justificatif has header + rows, comma decimals', () => {
    const csv = workforceToCsv(summary);
    expect(csv.split('\n')[0]).toBe('employe_id;employe;heures_travaillees;heures_absence;retard_min;brut');
    expect(csv).toContain('e1;Alice;160,00;2,00;15;2500,00');
    expect(csv).toContain('e2;Bob;80,00;0,00;0;');
  });
});
