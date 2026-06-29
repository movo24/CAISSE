import {
  buildSessionActivityEvent,
  buildCashSessionOpenedEvent,
  sessionDurationMinutes,
} from './session-events';

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

  describe('buildCashSessionOpenedEvent (POS-INT-105)', () => {
    it('emits a cash_session.opened lifecycle event', () => {
      const e = buildCashSessionOpenedEvent({
        sessionId: 's-9', storeId: 'store-1', organizationId: 'org-1',
        employeeId: 'emp-1', employeeRole: 'cashier', terminalId: 'T1',
        openedAt: open, offlineMode: true,
      });
      expect(e.type).toBe('cash_session.opened');
      expect(e.aggregateType).toBe('cash_session');
      expect(e.aggregateId).toBe('s-9');
      expect(e.tenant).toMatchObject({ storeId: 'store-1', organizationId: 'org-1', terminalId: 'T1' });
      expect(e.actor).toMatchObject({ employeeId: 'emp-1', role: 'cashier' });
      expect(e.payload).toMatchObject({ sessionId: 's-9', terminalId: 'T1', openedAt: open, offlineMode: true });
    });

    it('defaults occurredAt to openedAt and offlineMode to false', () => {
      const e = buildCashSessionOpenedEvent({
        sessionId: 's-2', storeId: 'store-1', employeeId: 'emp-1', terminalId: null, openedAt: open,
      });
      expect(e.occurredAt).toBe(open);
      expect(e.payload.offlineMode).toBe(false);
      expect(e.tenant.terminalId).toBeNull();
    });
  });
});
