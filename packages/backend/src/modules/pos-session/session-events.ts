/**
 * POS — Cash-session → employee activity event (pure, unit-testable).
 * Feeds the outbox so TimeWin24 (presence reconciliation) and Analytik R see
 * cashier worked-time at the terminal. Non-fiscal signal; emitted best-effort.
 */
import {
  buildIntegrationEvent,
  IntegrationEvent,
} from '../../common/integration/integration-event';

export interface SessionActivityInput {
  sessionId: string;
  storeId: string;
  organizationId?: string | null;
  employeeId: string;
  employeeRole?: string | null;
  terminalId: string | null;
  action: 'opened' | 'closed';
  openedAt: Date | string;
  closedAt?: Date | string | null;
  occurredAt?: Date | string;
}

/** Worked minutes between open and close (0 when still open or negative). */
export function sessionDurationMinutes(
  openedAt: Date | string,
  closedAt?: Date | string | null,
): number {
  if (!closedAt) return 0;
  const ms = new Date(closedAt).getTime() - new Date(openedAt).getTime();
  return ms > 0 ? Math.floor(ms / 60000) : 0;
}

/** `employee_activity.recorded` for a cash-session open/close. */
export function buildSessionActivityEvent(input: SessionActivityInput): IntegrationEvent {
  return buildIntegrationEvent({
    type: 'employee_activity.recorded',
    aggregateType: 'employee_activity',
    aggregateId: input.sessionId,
    tenant: {
      organizationId: input.organizationId ?? null,
      storeId: input.storeId,
      terminalId: input.terminalId,
    },
    actor: { employeeId: input.employeeId, role: input.employeeRole ?? null },
    occurredAt: input.occurredAt,
    payload: {
      activity: 'cash_session',
      action: input.action,
      sessionId: input.sessionId,
      terminalId: input.terminalId,
      openedAt: new Date(input.openedAt).toISOString(),
      closedAt: input.closedAt ? new Date(input.closedAt).toISOString() : null,
      durationMinutes: sessionDurationMinutes(input.openedAt, input.closedAt),
    },
  });
}
