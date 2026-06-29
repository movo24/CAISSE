import { isUpstreamUnavailable } from './upstream-status';

describe('POS auth upstream-status', () => {
  it('no status (network/unknown) → unavailable', () => {
    expect(isUpstreamUnavailable(undefined)).toBe(true);
    expect(isUpstreamUnavailable(null)).toBe(true);
  });
  it('5xx → unavailable', () => {
    expect(isUpstreamUnavailable(500)).toBe(true);
    expect(isUpstreamUnavailable(503)).toBe(true);
  });
  it('4xx (client/auth error) → available (not upstream failure)', () => {
    expect(isUpstreamUnavailable(401)).toBe(false);
    expect(isUpstreamUnavailable(404)).toBe(false);
    expect(isUpstreamUnavailable(400)).toBe(false);
  });
});
