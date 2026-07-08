import { normalizeShiftRecords, findEndedShiftFor } from './shift-normalize.util';

/**
 * Fin de shift TW24 — parsing défensif + doctrine « probant uniquement » :
 * une donnée absente ou ambiguë ne produit JAMAIS d'anomalie.
 */
describe('shift-normalize util', () => {
  const NOW = new Date('2026-03-16T18:00:00Z');

  describe('normalizeShiftRecords (endsAt + employeeId)', () => {
    it('parses endsAt and employeeId from the usual TW24 key variants', () => {
      const out = normalizeShiftRecords([
        { id: 's1', startsAt: '2026-03-16T08:00:00Z', endsAt: '2026-03-16T16:00:00Z', employeeId: 'emp-1' },
        { shift_id: 's2', start_at: '2026-03-16T09:00:00Z', end_at: '2026-03-16T17:00:00Z', employee_id: 42 },
        { shiftId: 's3', startTime: '2026-03-16T10:00:00Z', endTime: '2026-03-16T18:30:00Z', empId: 'emp-3' },
      ]);
      expect(out).toHaveLength(3);
      expect(out[0].endsAt?.toISOString()).toBe('2026-03-16T16:00:00.000Z');
      expect(out[0].employeeId).toBe('emp-1');
      expect(out[1].endsAt?.toISOString()).toBe('2026-03-16T17:00:00.000Z');
      expect(out[1].employeeId).toBe('42'); // numeric id → string
      expect(out[2].employeeId).toBe('emp-3');
    });

    it('keeps a shift without end/employee (endsAt/employeeId null, never guessed)', () => {
      const out = normalizeShiftRecords([{ id: 's1', startsAt: '2026-03-16T08:00:00Z' }]);
      expect(out).toHaveLength(1);
      expect(out[0].endsAt).toBeNull();
      expect(out[0].employeeId).toBeNull();
    });

    it('drops an unparseable end date instead of inventing one', () => {
      const out = normalizeShiftRecords([
        { id: 's1', startsAt: '2026-03-16T08:00:00Z', endsAt: 'not-a-date', employeeId: 'emp-1' },
      ]);
      expect(out[0].endsAt).toBeNull();
    });
  });

  describe('findEndedShiftFor (probant uniquement)', () => {
    const base = { employeeName: 'Alice', startsAt: new Date('2026-03-16T08:00:00Z') };

    it('returns the latest ended shift when ALL of the employee shifts are over', () => {
      const s = findEndedShiftFor(
        [
          { ...base, id: 's1', endsAt: new Date('2026-03-16T12:00:00Z'), employeeId: 'emp-1' },
          { ...base, id: 's2', endsAt: new Date('2026-03-16T16:00:00Z'), employeeId: 'emp-1' },
        ],
        'emp-1',
        NOW,
      );
      expect(s?.id).toBe('s2');
    });

    it('returns null when a shift is still open or upcoming (coupure / double service)', () => {
      const s = findEndedShiftFor(
        [
          { ...base, id: 's1', endsAt: new Date('2026-03-16T12:00:00Z'), employeeId: 'emp-1' },
          { ...base, id: 's2', endsAt: new Date('2026-03-16T22:00:00Z'), employeeId: 'emp-1' },
        ],
        'emp-1',
        NOW,
      );
      expect(s).toBeNull();
    });

    it('returns null when the feed has no employeeId for the employee (name match is not probant)', () => {
      const s = findEndedShiftFor(
        [{ ...base, id: 's1', endsAt: new Date('2026-03-16T12:00:00Z'), employeeId: null }],
        'emp-1',
        NOW,
      );
      expect(s).toBeNull();
    });

    it('returns null when any of the employee shifts lacks a parsed end (unknowable)', () => {
      const s = findEndedShiftFor(
        [
          { ...base, id: 's1', endsAt: new Date('2026-03-16T12:00:00Z'), employeeId: 'emp-1' },
          { ...base, id: 's2', endsAt: null, employeeId: 'emp-1' },
        ],
        'emp-1',
        NOW,
      );
      expect(s).toBeNull();
    });

    it('returns null for an employee with no shift in the feed', () => {
      expect(findEndedShiftFor([], 'emp-1', NOW)).toBeNull();
    });
  });
});
