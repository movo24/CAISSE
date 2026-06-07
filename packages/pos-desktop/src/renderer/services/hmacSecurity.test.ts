import { describe, it, expect, beforeEach } from 'vitest';
import { idempotencyKeyFor, isAlreadySent, markAsSent, unmarkSent } from './hmacSecurity';

describe('hmacSecurity — offline dedup keys', () => {
  beforeEach(() => localStorage.clear());

  it('builds a stable idempotency key from type + entry id', () => {
    expect(idempotencyKeyFor('ticket', 'abc')).toBe('ticket:abc');
    expect(idempotencyKeyFor('void', 'xyz')).toBe('void:xyz');
  });

  it('marks, detects and unmarks a sent entry (the offline-replay guard)', () => {
    expect(isAlreadySent('ticket', 'e1')).toBe(false);

    markAsSent('ticket', 'e1');
    expect(isAlreadySent('ticket', 'e1')).toBe(true);
    expect(isAlreadySent('ticket', 'e2')).toBe(false); // independent entries

    unmarkSent('ticket', 'e1'); // rollback on failed sync → entry retries
    expect(isAlreadySent('ticket', 'e1')).toBe(false);
  });

  it('unmark is a no-op for an entry that was never marked', () => {
    expect(() => unmarkSent('ticket', 'never')).not.toThrow();
    expect(isAlreadySent('ticket', 'never')).toBe(false);
  });
});
