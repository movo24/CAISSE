import { describe, it, expect } from 'vitest';
import {
  computePreset,
  isRangeValid,
  isSingleDay,
  frDate,
  rangeTitle,
  matchPreset,
  toIso,
} from './reportRange';

// Fixed "today" = Monday 2026-07-06.
const TODAY = new Date(2026, 6, 6); // month is 0-based → July

describe('computePreset', () => {
  it('today → same day', () => {
    expect(computePreset('today', TODAY)).toEqual({ start: '2026-07-06', end: '2026-07-06' });
  });
  it('yesterday → previous day', () => {
    expect(computePreset('yesterday', TODAY)).toEqual({ start: '2026-07-05', end: '2026-07-05' });
  });
  it('last7 → 7 inclusive days ending today', () => {
    expect(computePreset('last7', TODAY)).toEqual({ start: '2026-06-30', end: '2026-07-06' });
  });
  it('thisMonth → 1st of month to today', () => {
    expect(computePreset('thisMonth', TODAY)).toEqual({ start: '2026-07-01', end: '2026-07-06' });
  });
  it('lastMonth → full previous month', () => {
    expect(computePreset('lastMonth', TODAY)).toEqual({ start: '2026-06-01', end: '2026-06-30' });
  });
});

describe('isRangeValid', () => {
  it('accepts end === start and end > start', () => {
    expect(isRangeValid('2026-07-01', '2026-07-01')).toBe(true);
    expect(isRangeValid('2026-07-01', '2026-07-06')).toBe(true);
  });
  it('rejects end < start and malformed dates', () => {
    expect(isRangeValid('2026-07-06', '2026-07-01')).toBe(false);
    expect(isRangeValid('2026-07-01', 'nope')).toBe(false);
  });
});

describe('isSingleDay + titles', () => {
  it('detects single day', () => {
    expect(isSingleDay('2026-07-06', '2026-07-06')).toBe(true);
    expect(isSingleDay('2026-07-01', '2026-07-06')).toBe(false);
  });
  it('formats FR dates and titles', () => {
    expect(frDate('2026-07-06')).toBe('06/07/2026');
    expect(rangeTitle('2026-07-06', '2026-07-06')).toBe('Rapport du 06/07/2026');
    expect(rangeTitle('2026-07-01', '2026-07-06')).toBe('Rapport du 01/07/2026 au 06/07/2026');
  });
});

describe('matchPreset', () => {
  it('recognises a preset range and falls back to custom', () => {
    expect(matchPreset('2026-07-06', '2026-07-06', TODAY)).toBe('today');
    expect(matchPreset('2026-06-30', '2026-07-06', TODAY)).toBe('last7');
    expect(matchPreset('2026-07-02', '2026-07-05', TODAY)).toBe('custom');
  });
});

describe('toIso', () => {
  it('formats local date components with zero-padding', () => {
    expect(toIso(new Date(2026, 0, 3))).toBe('2026-01-03');
  });
});
