import { describe, it, expect } from 'vitest';
import { getTerminalId, TERMINAL_ID_KEY } from './terminal-id';

const memStorage = (initial: Record<string, string> = {}) => {
  const m = new Map(Object.entries(initial));
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    dump: () => Object.fromEntries(m),
  };
};

describe('terminal-id (P325)', () => {
  it('generates once, then always returns the SAME id (stable device identity)', () => {
    const s = memStorage();
    const first = getTerminalId(s as any);
    expect(first).toMatch(/^TERM-/);
    expect(getTerminalId(s as any)).toBe(first);
    expect(s.dump()[TERMINAL_ID_KEY]).toBe(first);
  });

  it('respects an admin-set label (manual override kept as-is)', () => {
    const s = memStorage({ [TERMINAL_ID_KEY]: 'CAISSE-1' });
    expect(getTerminalId(s as any)).toBe('CAISSE-1');
  });

  it('an empty/whitespace stored value is treated as unset (regenerated)', () => {
    const s = memStorage({ [TERMINAL_ID_KEY]: '   ' });
    expect(getTerminalId(s as any)).toMatch(/^TERM-/);
  });
});
