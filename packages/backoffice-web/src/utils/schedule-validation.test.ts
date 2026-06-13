import { describe, it, expect } from 'vitest';
import { validateScheduleDays } from './schedule-validation';

const day = (dayOfWeek: number, over: Partial<Parameters<typeof validateScheduleDays>[0][number]> = {}) => ({
  dayOfWeek, closed: false, openTime: '09:00', closeTime: '20:00', ...over,
});

describe('schedule validation (client mirror of the server guarantee)', () => {
  it('valid grid → no errors', () => {
    expect(validateScheduleDays([day(0), day(1), day(6, { openTime: '10:00', closeTime: '22:00' })])).toEqual({});
  });

  it('open ≥ close → error on that day only', () => {
    const errors = validateScheduleDays([day(0), day(2, { openTime: '20:00', closeTime: '09:00' })]);
    expect(Object.keys(errors)).toEqual(['2']);
    expect(errors[2]).toContain('précéder');
  });

  it('bad format → error; a CLOSED day carries no hours and is never in error', () => {
    const errors = validateScheduleDays([
      day(3, { openTime: '9h' }),
      day(0, { closed: true, openTime: null, closeTime: null }),
    ]);
    expect(Object.keys(errors)).toEqual(['3']);
    expect(errors[3]).toContain('HH:MM');
  });

  it('equal open/close is rejected (a zero-length day is a "fermé", not a pair)', () => {
    expect(validateScheduleDays([day(5, { openTime: '09:00', closeTime: '09:00' })])[5]).toBeTruthy();
  });
});
