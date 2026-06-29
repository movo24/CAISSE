import { buildSessionActivityEvent, sessionDurationMinutes } from './session-events';

describe('POS pos-session session-events', () => {
  const open = '2026-06-29T09:00:00.000Z';
  const close = '2026-06-29T17:30:00.000Z';

  describe('sessionDurationMinutes', () => {
    it('computes minutes between open and close', () => {
      expect(sessionDurationMinutes(open, close)).toBe(510);
    });
    it('0 when still open or negative', () => {
      expect(sessionDurationMinutes(open, null)).toBe(0);
      expect(sessionDurationMinutes(close, open)).toBe(0);
    });
  });

  it('open event has no duration and null closedAt', () => {
    const e = buildSessionActivityEvent({
      sessionId: 's-1', storeId: 'store-1', employeeId: 'emp-1', employeeRole: 'cashier',
      terminalId: 'T1', action: 'opened', openedAt: open, occurredAt: open,
    });
    expect(e.type).toBe('employee_activity.recorded');
    expect(e.aggregateType).toBe('employee_activity');
    expect(e.payload).toMatchObject({ action: 'opened', durationMinutes: 0, closedAt: null, terminalId: 'T1' });
    expect(e.tenant.terminalId).toBe('T1');
  });

  it('close event carries duration', () => {
    const e = buildSessionActivityEvent({
      sessionId: 's-1', storeId: 'store-1', employeeId: 'emp-1',
      terminalId: 'T1', action: 'closed', openedAt: open, closedAt: close, occurredAt: close,
    });
    expect(e.payload).toMatchObject({ action: 'closed', durationMinutes: 510 });
    expect(e.payload.closedAt).toBe(close);
  });
});
