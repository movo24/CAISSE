import { isHealthyTimeWinStatus } from './health-status';

describe('POS timewin health-status', () => {
  it('ok and degraded are healthy', () => {
    expect(isHealthyTimeWinStatus('ok')).toBe(true);
    expect(isHealthyTimeWinStatus('degraded')).toBe(true);
  });
  it('anything else is not healthy', () => {
    expect(isHealthyTimeWinStatus('down')).toBe(false);
    expect(isHealthyTimeWinStatus('error')).toBe(false);
    expect(isHealthyTimeWinStatus('')).toBe(false);
    expect(isHealthyTimeWinStatus(null)).toBe(false);
    expect(isHealthyTimeWinStatus(undefined)).toBe(false);
  });
});
