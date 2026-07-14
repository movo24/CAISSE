import { computeVisitFrequency } from './visit-frequency';

const NOW = new Date('2026-06-28T12:00:00Z');

describe('POS computeVisitFrequency', () => {
  it('no visits = unknown', () => {
    const f = computeVisitFrequency([], NOW);
    expect(f.visitCount).toBe(0);
    expect(f.segment).toBe('unknown');
    expect(f.averageIntervalDays).toBeNull();
  });

  it('single visit = new', () => {
    const f = computeVisitFrequency(['2026-06-25T12:00:00Z'], NOW);
    expect(f.visitCount).toBe(1);
    expect(f.segment).toBe('new');
    expect(f.daysSinceLastVisit).toBe(3);
  });

  it('regular: small average interval and recently seen', () => {
    // visits every ~3 days, last 1 day ago
    const f = computeVisitFrequency(
      ['2026-06-15', '2026-06-18', '2026-06-21', '2026-06-24', '2026-06-27'],
      NOW,
    );
    expect(f.visitCount).toBe(5);
    expect(f.averageIntervalDays).toBe(3);
    expect(f.segment).toBe('regular');
  });

  it('at_risk: silent far beyond the usual interval', () => {
    // usual ~2 days but last visit ~30 days ago
    const f = computeVisitFrequency(['2026-05-25', '2026-05-27', '2026-05-29'], NOW);
    expect(f.segment).toBe('at_risk');
  });

  it('occasional: large interval but not (yet) at risk', () => {
    // ~30-day cadence, last visit ~28 days ago (< 2× interval)
    const f = computeVisitFrequency(['2026-04-01', '2026-05-01', '2026-05-31'], NOW);
    expect(f.segment).toBe('occasional');
  });

  it('sorts unordered input', () => {
    const f = computeVisitFrequency(['2026-06-27', '2026-06-15', '2026-06-21'], NOW);
    expect(f.firstVisit).toBe(new Date('2026-06-15').toISOString());
    expect(f.lastVisit).toBe(new Date('2026-06-27').toISOString());
  });
});
