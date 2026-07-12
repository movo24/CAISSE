import { describe, expect, it } from 'vitest';

import {
  initialFetchState,
  reduceFetchState,
  sinceLabel,
} from './freshness';

describe('freshness state machine', () => {
  it('starts in loading with no data', () => {
    const s = initialFetchState<number>();
    expect(s.status).toBe('loading');
    expect(s.data).toBeNull();
  });

  it('success → fresh with timestamp', () => {
    let s = initialFetchState<number>();
    s = reduceFetchState(s, { type: 'start' });
    s = reduceFetchState(s, {
      type: 'success',
      data: 42,
      at: '2026-07-12T10:00:00Z',
    });
    expect(s.status).toBe('fresh');
    expect(s.data).toBe(42);
    expect(s.lastUpdatedAt).toBe('2026-07-12T10:00:00Z');
    expect(s.refreshing).toBe(false);
  });

  it('failure AFTER a success keeps the last known data as stale — never a fake zero', () => {
    let s = initialFetchState<number>();
    s = reduceFetchState(s, {
      type: 'success',
      data: 42,
      at: '2026-07-12T10:00:00Z',
    });
    s = reduceFetchState(s, { type: 'failure', message: 'timeout' });
    expect(s.status).toBe('stale');
    expect(s.data).toBe(42); // last known value preserved
    expect(s.lastUpdatedAt).toBe('2026-07-12T10:00:00Z');
    expect(s.errorMessage).toBe('timeout');
  });

  it('failure with no prior data is a plain error state', () => {
    let s = initialFetchState<number>();
    s = reduceFetchState(s, { type: 'failure', message: 'backend down' });
    expect(s.status).toBe('error');
    expect(s.data).toBeNull();
  });

  it('a later success clears staleness', () => {
    let s = initialFetchState<number>();
    s = reduceFetchState(s, {
      type: 'success',
      data: 1,
      at: '2026-07-12T10:00:00Z',
    });
    s = reduceFetchState(s, { type: 'failure', message: 'x' });
    s = reduceFetchState(s, {
      type: 'success',
      data: 2,
      at: '2026-07-12T10:05:00Z',
    });
    expect(s.status).toBe('fresh');
    expect(s.data).toBe(2);
    expect(s.errorMessage).toBeNull();
  });
});

describe('sinceLabel', () => {
  const now = new Date('2026-07-12T10:10:00Z');

  it('shows seconds then minutes', () => {
    expect(sinceLabel('2026-07-12T10:09:30Z', now)).toBe('il y a 30 s');
    expect(sinceLabel('2026-07-12T10:00:00Z', now)).toBe('il y a 10 min');
  });

  it('falls back to a clock time after an hour', () => {
    expect(sinceLabel('2026-07-12T08:00:00Z', now)).toMatch(/^à \d{2}:\d{2}$/);
  });

  it('renders unknown as em-dash', () => {
    expect(sinceLabel(null, now)).toBe('—');
  });
});
