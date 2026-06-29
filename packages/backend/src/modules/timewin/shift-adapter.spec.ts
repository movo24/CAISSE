import { toWorkIntervals } from './shift-adapter';

describe('TimeWin24 shift-adapter', () => {
  it('maps array with start/end', () => {
    const r = toWorkIntervals([{ start: 'a', end: 'b' }]);
    expect(r).toEqual([{ start: 'a', end: 'b' }]);
  });
  it('supports clockIn/clockOut and unwraps {shifts}', () => {
    const r = toWorkIntervals({ shifts: [{ clockIn: 'x', clockOut: 'y' }] });
    expect(r).toEqual([{ start: 'x', end: 'y' }]);
  });
  it('supports debut/fin and {data}', () => {
    expect(toWorkIntervals({ data: [{ debut: '9', fin: '17' }] })).toEqual([{ start: '9', end: '17' }]);
  });
  it('open shift → end null', () => {
    expect(toWorkIntervals([{ start: 'a' }])).toEqual([{ start: 'a', end: null }]);
  });
  it('drops items without a start, never throws on junk', () => {
    expect(toWorkIntervals([{ foo: 1 }, null, 5])).toEqual([]);
    expect(toWorkIntervals(null)).toEqual([]);
    expect(toWorkIntervals('nope')).toEqual([]);
  });
});
