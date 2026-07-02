import { checkSocialChart } from './check-social-chart';

// P320 (cycle I3) — the structural validator mirrors the runtime guard exactly.

const FULL = {
  accounts: {
    grossSalaries: '641000',
    employerCharges: '645000',
    socialAgenciesPayable: '431000',
    netPayable: '421000',
  },
  validatedBy: 'Cabinet X — expert-comptable',
  validatedAt: '2026-07-15',
};

describe('checkSocialChart (GATE 3 template validator)', () => {
  it('accepts a complete, validated chart', () => {
    expect(checkSocialChart(FULL)).toEqual({ ok: true, errors: [] });
  });

  it('refuses missing/empty slots and names them', () => {
    const res = checkSocialChart({ ...FULL, accounts: { ...FULL.accounts, netPayable: ' ' } });
    expect(res.ok).toBe(false);
    expect(res.errors.join(' ')).toContain('netPayable');
  });

  it('refuses a chart without validatedBy (no accountant proof = no go)', () => {
    const res = checkSocialChart({ ...FULL, validatedBy: '' });
    expect(res.ok).toBe(false);
    expect(res.errors.join(' ')).toMatch(/validé|validatedBy/i);
  });

  it('flags a malformed validatedAt and unknown slot keys (typos)', () => {
    const res = checkSocialChart({
      ...FULL,
      validatedAt: '15/07/2026',
      accounts: { ...FULL.accounts, grossSalarys: '641' },
    } as any);
    expect(res.ok).toBe(false);
    expect(res.errors.join(' ')).toContain('ISO');
    expect(res.errors.join(' ')).toContain('grossSalarys');
  });

  it('refuses non-object input', () => {
    expect(checkSocialChart('nope').ok).toBe(false);
  });
});
