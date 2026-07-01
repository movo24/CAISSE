import { describe, it, expect } from 'vitest';
import { safeErrorMessage } from './safeErrorMessage';

describe('safeErrorMessage (POS-FE-197)', () => {
  it('returns a plain string message', () => {
    expect(safeErrorMessage({ response: { data: { message: 'Boom' } } })).toBe('Boom');
  });

  it('joins a string[] message (NestJS validation)', () => {
    expect(safeErrorMessage({ response: { data: { message: ['a', 'b'] } } })).toBe('a, b');
  });

  it('stringifies an object message (prevents React #310 crash)', () => {
    const out = safeErrorMessage({ response: { data: { message: { code: 'X' } } } });
    expect(typeof out).toBe('string');
    expect(out).toContain('X');
  });

  it('falls back to err.message then to the default', () => {
    expect(safeErrorMessage({ message: 'net down' })).toBe('net down');
    expect(safeErrorMessage(undefined)).toBe('Erreur inattendue');
    expect(safeErrorMessage({}, 'custom')).toBe('custom');
  });
});
