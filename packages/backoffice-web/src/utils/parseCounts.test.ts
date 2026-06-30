import { describe, it, expect } from 'vitest';
import { parseCounts } from './parseCounts';

describe('parseCounts (POS-FE-155)', () => {
  it('parses ; , tab and space separators', () => {
    expect(parseCounts('300;12\n301,5\n302\t0\n303 7')).toEqual([
      { ean: '300', countedQty: 12 },
      { ean: '301', countedQty: 5 },
      { ean: '302', countedQty: 0 },
      { ean: '303', countedQty: 7 },
    ]);
  });

  it('ignores blank and invalid lines', () => {
    expect(parseCounts('\n  \n300\nbad;x\n300;9')).toEqual([{ ean: '300', countedQty: 9 }]);
  });

  it('takes the last token as quantity (handles extra columns)', () => {
    expect(parseCounts('300;Café Bio;12')).toEqual([{ ean: '300', countedQty: 12 }]);
  });

  it('empty / nullish input → []', () => {
    expect(parseCounts('')).toEqual([]);
    expect(parseCounts(undefined as any)).toEqual([]);
  });
});
