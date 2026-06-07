import { describe, it, expect } from 'vitest';
import { buildCsv } from './export-utils';

describe('export-utils buildCsv', () => {
  it('uses a UTF-8 BOM, ; separator and quoted cells', () => {
    const csv = buildCsv(['A', 'B'], [['1', '2']]);
    expect(csv.charCodeAt(0)).toBe(0xfeff); // BOM for Excel
    const lines = csv.slice(1).split('\n');
    expect(lines[0]).toBe('A;B');
    expect(lines[1]).toBe('"1";"2"');
  });

  it('escapes embedded double quotes (RFC 4180 doubling)', () => {
    const csv = buildCsv(['Nom'], [['Jean "le grand"']]);
    expect(csv.slice(1).split('\n')[1]).toBe('"Jean ""le grand"""');
  });

  it('handles an empty row set (header only)', () => {
    const csv = buildCsv(['X', 'Y'], []);
    expect(csv.slice(1)).toBe('X;Y');
  });
});
