/**
 * Dependency-free CSV util (Bloc 4i support). Adverse surface = the RFC-4180
 * quoting cases pg-mem/naive split() get wrong: embedded commas, doubled quotes,
 * embedded newlines, CRLF vs LF, no trailing newline.
 */
import { parseCsv, toCsv, parseCsvWithHeader, stripFormulaGuard } from '../src/common/csv/csv.util';

describe('CSV util (RFC-4180, zero-dependency)', () => {
  it('parses simple rows (LF and CRLF, with/without trailing newline)', () => {
    expect(parseCsv('a,b\n1,2\n')).toEqual([['a', 'b'], ['1', '2']]);
    expect(parseCsv('a,b\r\n1,2')).toEqual([['a', 'b'], ['1', '2']]);
  });

  it('DECISIVE — quoted fields: embedded comma, doubled quote, embedded newline', () => {
    const text = 'name,note\r\n"Bonbon, fraise","dit ""miam""\nsuite"\r\n';
    expect(parseCsv(text)).toEqual([
      ['name', 'note'],
      ['Bonbon, fraise', 'dit "miam"\nsuite'],
    ]);
  });

  it('round-trips through toCsv → parseCsv (quoting is reversible)', () => {
    const rows = [
      ['ean', 'name', 'price'],
      ['360', 'A,B', '100'],
      ['361', 'say "hi"', '200'],
      ['362', 'line\nbreak', '300'],
    ];
    expect(parseCsv(toCsv(rows))).toEqual(rows);
  });

  it('parseCsvWithHeader keys by header, trims, drops blank lines', () => {
    const text = 'ean, name ,price\n360,Bonbon,100\n\n361,Sucette,50\n';
    expect(parseCsvWithHeader(text)).toEqual([
      { ean: '360', name: 'Bonbon', price: '100' },
      { ean: '361', name: 'Sucette', price: '50' },
    ]);
  });

  it('empty input → no rows', () => {
    expect(parseCsv('')).toEqual([]);
    expect(parseCsvWithHeader('')).toEqual([]);
  });

  it('stripFormulaGuard reverses the export guard → lossless round-trip for "-40% Promo" / "@Home" (M105)', () => {
    for (const name of ['-40% Promo', '@Home', '=Total', '+Energy']) {
      const guarded = toCsv([[name]]).trim();           // export adds the apostrophe
      expect(guarded.startsWith("'")).toBe(true);
      const parsed = parseCsv(guarded + '\r\n')[0][0];  // raw cell still has the apostrophe
      expect(stripFormulaGuard(parsed)).toBe(name);      // import strips it → original restored
    }
  });

  it('stripFormulaGuard leaves a normal value (and a lone apostrophe) untouched', () => {
    expect(stripFormulaGuard('Bonbon')).toBe('Bonbon');
    expect(stripFormulaGuard("O'Neill")).toBe("O'Neill"); // apostrophe not before a formula char
  });

  it('DECISIVE — neutralises CSV formula injection in STRING cells, leaves numbers intact (CWE-1236)', () => {
    const parsed = parseCsv(
      toCsv([
        ['=SUM(A1)'], // formula → guarded
        ['+ping'],    // guarded
        ['@cmd'],     // guarded
        ['-5'],       // string starting with '-' → guarded
        [-7],         // NUMBER → must stay numeric, NOT guarded
        ['Normal'],   // untouched
      ]),
    );
    expect(parsed).toEqual([
      [`'=SUM(A1)`],
      [`'+ping`],
      [`'@cmd`],
      [`'-5`],
      ['-7'], // number was not prefixed
      ['Normal'],
    ]);
  });
});
