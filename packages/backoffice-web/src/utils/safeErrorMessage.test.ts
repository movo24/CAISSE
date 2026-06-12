import { describe, it, expect } from 'vitest';
import { safeErrorMessage } from './safeErrorMessage';

describe('safeErrorMessage', () => {
  it('returns a plain string message as-is', () => {
    expect(safeErrorMessage({ message: 'boom' })).toBe('boom');
  });

  it('prefers response.data.message over err.message', () => {
    expect(
      safeErrorMessage({ response: { data: { message: 'api error' } }, message: 'local' }),
    ).toBe('api error');
  });

  it('joins a string[] message with ", " (NestJS validation shape)', () => {
    expect(
      safeErrorMessage({ response: { data: { message: ['email invalid', 'pin required'] } } }),
    ).toBe('email invalid, pin required');
  });

  it('coerces non-string array entries via String', () => {
    expect(safeErrorMessage({ message: [1, 2, 3] })).toBe('1, 2, 3');
  });

  it('stringifies an object message (prevents React #310 object-as-child crash)', () => {
    expect(safeErrorMessage({ message: { code: 42 } })).toBe('{"code":42}');
  });

  it('falls back when there is no message', () => {
    expect(safeErrorMessage({})).toBe('Erreur inattendue');
    expect(safeErrorMessage(null)).toBe('Erreur inattendue');
    expect(safeErrorMessage(undefined)).toBe('Erreur inattendue');
  });

  it('uses a custom fallback', () => {
    expect(safeErrorMessage(null, 'oops')).toBe('oops');
    expect(safeErrorMessage({ foo: 'bar' }, 'oops')).toBe('oops');
  });
});
