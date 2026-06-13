/**
 * Schedule chantier commit 4 — deterministic French holidays. The movable
 * feasts are the adverse surface: Easter via Meeus/Jonckheere, checked against
 * known calendar years (incl. a March Easter and a leap year).
 */
import { easterSunday, frenchHolidays, holidayKeyOf } from '../src/modules/store-schedule/french-holidays.util';

describe('French holidays — deterministic (Meeus/Jonckheere)', () => {
  it('Easter Sunday across known years (March/April, leap and non-leap)', () => {
    expect(easterSunday(2024)).toBe('2024-03-31'); // March Easter, leap year
    expect(easterSunday(2025)).toBe('2025-04-20');
    expect(easterSunday(2026)).toBe('2026-04-05');
    expect(easterSunday(2027)).toBe('2027-03-28');
    expect(easterSunday(2038)).toBe('2038-04-25'); // latest possible Easter this century
  });

  it('the 11 holidays of 2026 land on the right days', () => {
    const h = frenchHolidays(2026);
    expect(h.get('2026-01-01')).toBe('jour_de_l_an');
    expect(h.get('2026-04-06')).toBe('lundi_de_paques'); // Easter 04-05 + 1
    expect(h.get('2026-05-01')).toBe('fete_du_travail');
    expect(h.get('2026-05-08')).toBe('victoire_1945');
    expect(h.get('2026-05-14')).toBe('ascension'); // Easter + 39
    expect(h.get('2026-05-25')).toBe('lundi_de_pentecote'); // Easter + 50
    expect(h.get('2026-07-14')).toBe('fete_nationale');
    expect(h.get('2026-08-15')).toBe('assomption');
    expect(h.get('2026-11-01')).toBe('toussaint');
    expect(h.get('2026-11-11')).toBe('armistice_1918');
    expect(h.get('2026-12-25')).toBe('noel');
    expect(h.size).toBe(11);
  });

  it('movable feasts crossing a month boundary (2024: lundi de Pâques = April 1st)', () => {
    const h = frenchHolidays(2024);
    expect(h.get('2024-04-01')).toBe('lundi_de_paques'); // 03-31 + 1 crosses the month
    expect(h.get('2024-05-09')).toBe('ascension');
    expect(h.get('2024-05-20')).toBe('lundi_de_pentecote');
  });

  it('holidayKeyOf: holiday vs ordinary day', () => {
    expect(holidayKeyOf('2026-07-14')).toBe('fete_nationale');
    expect(holidayKeyOf('2026-07-15')).toBeNull();
    expect(holidayKeyOf('2026-06-13')).toBeNull();
  });
});
