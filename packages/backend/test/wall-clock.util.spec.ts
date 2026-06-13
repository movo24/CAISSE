/**
 * A1 — wall-clock utilities. THE ratified adverse test: the DST flip — the same
 * WALL hour on either side of the change behaves identically although the UTC
 * offsets differ. Europe/Paris 2026: spring forward Sun 2026-03-29 (02:00→03:00,
 * a 23h day), fall back Sun 2026-10-25 (03:00→02:00, a 25h day).
 */
import { localDayString, localHourOf, shiftDayString, localDayRange } from '../src/common/clock/wall-clock.util';

const PARIS = 'Europe/Paris';

describe('A1 — wall-clock utils (DST-correct)', () => {
  it('DECISIVE DST — the same wall hour on both sides of the spring flip, from DIFFERENT UTC hours', () => {
    // Saturday before the flip: UTC+1 → 21:30 local is 20:30Z.
    expect(localHourOf(new Date('2026-03-28T20:30:00Z'), PARIS)).toBe(21);
    // Monday after the flip: UTC+2 → 21:30 local is 19:30Z.
    expect(localHourOf(new Date('2026-03-30T19:30:00Z'), PARIS)).toBe(21);
    // Same wall hour, one UTC hour apart — a close_hour=20 rule fires identically on both days.
  });

  it('DECISIVE DST — fall-back symmetry (October)', () => {
    expect(localHourOf(new Date('2026-10-24T19:30:00Z'), PARIS)).toBe(21); // UTC+2
    expect(localHourOf(new Date('2026-10-26T20:30:00Z'), PARIS)).toBe(21); // UTC+1
  });

  it('local day crosses midnight correctly (the UTC-stand-in bug this replaces)', () => {
    // 23:30Z in winter = 00:30 Paris NEXT day.
    expect(localDayString(new Date('2026-01-15T23:30:00Z'), PARIS)).toBe('2026-01-16');
    // 22:30Z in summer = 00:30 Paris next day.
    expect(localDayString(new Date('2026-07-15T22:30:00Z'), PARIS)).toBe('2026-07-16');
    // …whereas mid-day is the same calendar day.
    expect(localDayString(new Date('2026-01-15T12:00:00Z'), PARIS)).toBe('2026-01-15');
  });

  it('localDayRange — a spring-forward day lasts 23h, a fall-back day 25h', () => {
    const spring = localDayRange('2026-03-29', PARIS);
    expect(spring.start.toISOString()).toBe('2026-03-28T23:00:00.000Z'); // midnight at UTC+1
    expect(spring.end.toISOString()).toBe('2026-03-29T22:00:00.000Z'); // next midnight at UTC+2
    expect(spring.end.getTime() - spring.start.getTime()).toBe(23 * 3600_000);

    const fall = localDayRange('2026-10-25', PARIS);
    expect(fall.end.getTime() - fall.start.getTime()).toBe(25 * 3600_000);

    const plain = localDayRange('2026-01-15', PARIS);
    expect(plain.end.getTime() - plain.start.getTime()).toBe(24 * 3600_000);
  });

  it('localDayRange under UTC behaves as the old stand-in (continuity)', () => {
    const r = localDayRange('2026-06-12', 'Etc/UTC');
    expect(r.start.toISOString()).toBe('2026-06-12T00:00:00.000Z');
    expect(r.end.toISOString()).toBe('2026-06-13T00:00:00.000Z');
  });

  it('shiftDayString — calendar arithmetic incl. month/leap edges, zone-free', () => {
    expect(shiftDayString('2026-03-01', -1)).toBe('2026-02-28');
    expect(shiftDayString('2024-03-01', -1)).toBe('2024-02-29'); // leap
    expect(shiftDayString('2026-12-31', 1)).toBe('2027-01-01');
    expect(shiftDayString('2026-06-12', -7)).toBe('2026-06-05');
  });
});
