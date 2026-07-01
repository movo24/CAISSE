import {
  canPostSocialEntries,
  assertSocialEntriesAllowed,
  REQUIRED_SOCIAL_ACCOUNT_SLOTS,
  ValidatedSocialChart,
} from './social-entries-guard';

const fullChart: ValidatedSocialChart = {
  accounts: { grossSalaries: '641', employerCharges: '645', socialAgenciesPayable: '431', netPayable: '421' },
  validatedBy: 'expert-comptable@cabinet',
  validatedAt: '2026-07-01',
};

describe('social-entries-guard (POS-INT-208, TD-INT-SOCIAL-ENTRIES)', () => {
  it('BLOCKS when the env flag is off, even with a full validated chart', () => {
    expect(canPostSocialEntries(undefined, fullChart).allowed).toBe(false);
    expect(canPostSocialEntries('false', fullChart).allowed).toBe(false);
  });

  it('BLOCKS when flag on but no chart supplied', () => {
    const r = canPostSocialEntries('true', null);
    expect(r.allowed).toBe(false);
    expect(r.reason).toMatch(/plan de comptes social/i);
  });

  it('BLOCKS with an incomplete chart and lists the missing slots', () => {
    const r = canPostSocialEntries('true', { accounts: { grossSalaries: '641' }, validatedBy: 'x' });
    expect(r.allowed).toBe(false);
    expect(r.missingSlots).toEqual(expect.arrayContaining(['employerCharges', 'socialAgenciesPayable', 'netPayable']));
  });

  it('BLOCKS when accounts are complete but validation proof (validatedBy) is missing', () => {
    const r = canPostSocialEntries('true', { accounts: fullChart.accounts });
    expect(r.allowed).toBe(false);
    expect(r.reason).toMatch(/non validé/i);
  });

  it('ALLOWS only with flag on + all slots filled + validatedBy present', () => {
    expect(canPostSocialEntries('true', fullChart)).toEqual({ allowed: true });
    expect(canPostSocialEntries('1', fullChart).allowed).toBe(true);
  });

  it('assertSocialEntriesAllowed throws when blocked, passes when allowed', () => {
    expect(() => assertSocialEntriesAllowed('true', null)).toThrow(/TD-INT-SOCIAL-ENTRIES/);
    expect(() => assertSocialEntriesAllowed('true', fullChart)).not.toThrow();
  });

  it('declares exactly the 4 required semantic slots', () => {
    expect(REQUIRED_SOCIAL_ACCOUNT_SLOTS).toEqual(['grossSalaries', 'employerCharges', 'socialAgenciesPayable', 'netPayable']);
  });
});
