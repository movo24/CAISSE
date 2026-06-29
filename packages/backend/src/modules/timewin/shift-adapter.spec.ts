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

  describe('employee filter (TD-INT-RECON-PEREMP)', () => {
    const rows = [
      { employeeId: 'e1', start: 'a', end: 'b' },
      { employee_id: 'e2', start: 'c', end: 'd' },
      { start: 'x', end: 'y' }, // no employee id
    ];
    it('keeps only matching employee shifts', () => {
      expect(toWorkIntervals(rows, { employeeId: 'e1' })).toEqual([{ start: 'a', end: 'b' }]);
      expect(toWorkIntervals(rows, { employeeId: 'e2' })).toEqual([{ start: 'c', end: 'd' }]);
    });
    it('drops shifts lacking an employee id when filtering', () => {
      expect(toWorkIntervals(rows, { employeeId: 'e9' })).toEqual([]);
    });
    it('no filter → all shifts (incl. id-less)', () => {
      expect(toWorkIntervals(rows)).toHaveLength(3);
    });
  });
});
