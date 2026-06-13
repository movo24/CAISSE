import { shiftDayString } from '../../common/clock/wall-clock.util';

/**
 * French public holidays (métropole) — fully DETERMINISTIC, zero external
 * dependency (ratified). Fixed dates + the movable feasts derived from Easter
 * via the Meeus/Jonckheere algorithm. Stable keys are what the owner's
 * store_holiday_closures rows reference (a closure means "THIS store closes on
 * that holiday" — selected per store, never assumed).
 *
 * Day strings are LOCAL calendar days ('YYYY-MM-DD'), zone-free by construction
 * (composed with the A1 local business day).
 */
export const FRENCH_HOLIDAY_KEYS = [
  'jour_de_l_an',
  'lundi_de_paques',
  'fete_du_travail',
  'victoire_1945',
  'ascension',
  'lundi_de_pentecote',
  'fete_nationale',
  'assomption',
  'toussaint',
  'armistice_1918',
  'noel',
] as const;
export type FrenchHolidayKey = (typeof FRENCH_HOLIDAY_KEYS)[number];

/** Easter Sunday (Gregorian) — Meeus/Jonckheere, valid for all Gregorian years. */
export function easterSunday(year: number): string {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** The year's 11 holidays as a Map<'YYYY-MM-DD', key>. */
export function frenchHolidays(year: number): Map<string, FrenchHolidayKey> {
  const easter = easterSunday(year);
  const fixed = (mmdd: string) => `${year}-${mmdd}`;
  return new Map<string, FrenchHolidayKey>([
    [fixed('01-01'), 'jour_de_l_an'],
    [shiftDayString(easter, 1), 'lundi_de_paques'],
    [fixed('05-01'), 'fete_du_travail'],
    [fixed('05-08'), 'victoire_1945'],
    [shiftDayString(easter, 39), 'ascension'],
    [shiftDayString(easter, 50), 'lundi_de_pentecote'],
    [fixed('07-14'), 'fete_nationale'],
    [fixed('08-15'), 'assomption'],
    [fixed('11-01'), 'toussaint'],
    [fixed('11-11'), 'armistice_1918'],
    [fixed('12-25'), 'noel'],
  ]);
}

/** The holiday key of a LOCAL day string, or null if it is an ordinary day. */
export function holidayKeyOf(localDay: string): FrenchHolidayKey | null {
  const year = Number(localDay.slice(0, 4));
  return frenchHolidays(year).get(localDay) ?? null;
}
