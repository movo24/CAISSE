import {
  overallVerdict,
  missingEnvVars,
  missingRequiredKeys,
  statusFromGap,
  exitCode,
} from './preflight-checks';

describe('preflight-checks (POS-INT-216)', () => {
  it('overallVerdict: fail dominates warn dominates pass', () => {
    expect(overallVerdict([{ name: 'a', status: 'pass' }])).toBe('pass');
    expect(overallVerdict([{ name: 'a', status: 'pass' }, { name: 'b', status: 'warn' }])).toBe('warn');
    expect(overallVerdict([{ name: 'a', status: 'warn' }, { name: 'b', status: 'fail' }])).toBe('fail');
    expect(overallVerdict([])).toBe('pass');
  });

  it('missingEnvVars: used-but-undocumented, deduped + sorted', () => {
    expect(missingEnvVars(['B', 'A', 'A', 'C'], ['A'])).toEqual(['B', 'C']);
    expect(missingEnvVars(['A'], ['A', 'B'])).toEqual([]);
  });

  it('missingRequiredKeys: required not documented', () => {
    expect(missingRequiredKeys(['JWT_SECRET'], ['JWT_SECRET', 'DATABASE_URL'])).toEqual(['DATABASE_URL']);
    expect(missingRequiredKeys(['JWT_SECRET', 'DATABASE_URL'], ['JWT_SECRET'])).toEqual([]);
  });

  it('statusFromGap: empty=pass, else given severity', () => {
    expect(statusFromGap([], 'fail')).toBe('pass');
    expect(statusFromGap(['x'], 'fail')).toBe('fail');
    expect(statusFromGap(['x'], 'warn')).toBe('warn');
  });

  it('exitCode: fail=1, warn/pass=0 (warn non-blocking)', () => {
    expect(exitCode('fail')).toBe(1);
    expect(exitCode('warn')).toBe(0);
    expect(exitCode('pass')).toBe(0);
  });
});
