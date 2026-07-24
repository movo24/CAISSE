import { weatherImpact } from './weather-impact';

describe('POS sales-ai weather-impact', () => {
  it('rain / drizzle → -0.3', () => {
    expect(weatherImpact(18, 'rain').impactScore).toBe(-0.3);
    expect(weatherImpact(18, 'drizzle').impactScore).toBe(-0.3);
  });
  it('snow / storm → -0.6 (takes precedence over temp)', () => {
    expect(weatherImpact(2, 'snow').impactScore).toBe(-0.6);
    expect(weatherImpact(35, 'storm').impactScore).toBe(-0.6);
  });
  it('hot (>30) → +0.4', () => {
    expect(weatherImpact(33, 'clear').impactScore).toBe(0.4);
  });
  it('cold (<5) → -0.2', () => {
    expect(weatherImpact(2, 'clouds').impactScore).toBe(-0.2);
  });
  it('clear & mild (15<t<28) → +0.3', () => {
    expect(weatherImpact(22, 'clear').impactScore).toBe(0.3);
  });
  it('otherwise neutral', () => {
    const r = weatherImpact(12, 'clouds');
    expect(r.impactScore).toBe(0);
    expect(r.impactReason).toBe('Conditions normales');
  });
  it('empty/unknown condition is safe', () => {
    expect(weatherImpact(20, '').impactScore).toBe(0);
  });
});
