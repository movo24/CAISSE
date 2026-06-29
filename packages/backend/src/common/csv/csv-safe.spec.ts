import { csvSafeCell, csvSafeRow } from './csv-safe';

describe('csv-safe — CSV injection hardening (POS-INT-113)', () => {
  describe('formula injection guard (text cells)', () => {
    it.each([
      ['=cmd|"/C calc"!A1', "'=cmd|\"/C calc\"!A1"],
      ['+1+1', "'+1+1"],
      ['-2+3+cmd', "'-2+3+cmd"],
      ['@SUM(A1)', "'@SUM(A1)"],
      ['\tTAB', "'\tTAB"],
      ['\rCR', "'\rCR"],
    ])('neutralizes leading %j', (input, expectedStart) => {
      const out = csvSafeCell(input);
      // the cell must begin with the apostrophe-prefixed literal (quoting may wrap it)
      const unquoted = out.startsWith('"') ? out.slice(1, -1).replace(/""/g, '"') : out;
      expect(unquoted).toBe(expectedStart);
    });

    it('leaves a benign text cell untouched', () => {
      expect(csvSafeCell('cashier-7')).toBe('cashier-7');
    });
  });

  describe('numbers/booleans are never formula-guarded', () => {
    it('negative amount stays a real number (not prefixed)', () => {
      expect(csvSafeCell(-100)).toBe('-100');
      expect(csvSafeCell(0)).toBe('0');
      expect(csvSafeCell(4900)).toBe('4900');
    });
    it('booleans pass through', () => {
      expect(csvSafeCell(true)).toBe('true');
      expect(csvSafeCell(false)).toBe('false');
    });
  });

  describe('RFC4180 quoting', () => {
    it('quotes delimiters, quotes and newlines', () => {
      expect(csvSafeCell('a,b')).toBe('"a,b"');
      expect(csvSafeCell('a;b')).toBe('"a;b"');
      expect(csvSafeCell('he said "hi"')).toBe('"he said ""hi"""');
      expect(csvSafeCell('line1\nline2')).toBe('"line1\nline2"');
    });
    it('quotes a neutralized cell that also contains a delimiter', () => {
      // "=1,2" → guard → '=1,2 → contains comma → quoted
      expect(csvSafeCell('=1,2')).toBe('"\'=1,2"');
    });
  });

  describe('null/undefined', () => {
    it('emits empty', () => {
      expect(csvSafeCell(null)).toBe('');
      expect(csvSafeCell(undefined)).toBe('');
    });
  });

  describe('csvSafeRow', () => {
    it('joins hardened cells with the delimiter', () => {
      expect(csvSafeRow(['cash', 4900, -100])).toBe('cash,4900,-100');
      expect(csvSafeRow(['a', 'b'], ';')).toBe('a;b');
    });
  });
});
