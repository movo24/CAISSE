/**
 * POS-INT-106 — shift amplitude aggregation (pure, unit-testable).
 *
 * Pairs cash-session lifecycle signals from the integration outbox into per-shift
 * records (open → close) and per-employee totals. Consumes:
 *   - `cash_session.opened`        → shift start (openedAt, terminal, employee)
 *   - `employee_activity.recorded` action=closed → shift end (closedAt, duration)
 *
 * Used by TimeWin24 presence reconciliation and Analytik R occupancy. Pure: no
 * DB, no Nest. Tolerant — an unmatched open (still on shift) or a close without a
 * known open is surfaced rather than dropped.
 */

export interface ShiftEvent {
  sessionId: string;
  employeeId: string;
  terminalId: string | null;
  kind: 'open' | 'close';
  at: string; // ISO occurredAt of the lifecycle point
  durationMinutes?: number | null; // provided on close events
}

export interface ShiftRecord {
  sessionId: string;
  employeeId: string;
  terminalId: string | null;
  openedAt: string | null;
  closedAt: string | null;
  durationMinutes: number; // 0 while still open or when unknown
  open: boolean; // true when no matching close was seen
}

export interface ShiftSummary {
  shifts: ShiftRecord[];
  byEmployee: { employeeId: string; shiftCount: number; totalMinutes: number }[];
  totalMinutes: number;
}

function minutesBetween(openedAt: string | null, closedAt: string | null): number {
  if (!openedAt || !closedAt) return 0;
  const ms = new Date(closedAt).getTime() - new Date(openedAt).getTime();
  return ms > 0 ? Math.floor(ms / 60000) : 0;
}

/**
 * Build per-shift records + per-employee totals from lifecycle events.
 * Shifts are keyed by sessionId; duration prefers the explicit close
 * `durationMinutes`, falling back to (closedAt − openedAt).
 */
export function summarizeShifts(events: readonly ShiftEvent[]): ShiftSummary {
  const bySession = new Map<string, ShiftRecord>();

  const get = (e: ShiftEvent): ShiftRecord => {
    let r = bySession.get(e.sessionId);
    if (!r) {
      r = {
        sessionId: e.sessionId,
        employeeId: e.employeeId,
        terminalId: e.terminalId,
        openedAt: null,
        closedAt: null,
        durationMinutes: 0,
        open: true,
      };
      bySession.set(e.sessionId, r);
    }
    return r;
  };

  for (const e of events) {
    if (!e.sessionId) continue;
    const r = get(e);
    if (e.employeeId) r.employeeId = e.employeeId;
    if (e.terminalId != null) r.terminalId = e.terminalId;
    if (e.kind === 'open') {
      r.openedAt = e.at;
    } else {
      r.closedAt = e.at;
      r.open = false;
      const explicit = typeof e.durationMinutes === 'number' && e.durationMinutes >= 0 ? e.durationMinutes : null;
      r.durationMinutes = explicit ?? minutesBetween(r.openedAt, r.closedAt);
    }
  }

  // recompute duration for any closed shift that learned its openedAt after close
  for (const r of bySession.values()) {
    if (!r.open && r.durationMinutes === 0) {
      r.durationMinutes = minutesBetween(r.openedAt, r.closedAt);
    }
  }

  const shifts = [...bySession.values()].sort((a, b) =>
    (a.openedAt ?? a.closedAt ?? '').localeCompare(b.openedAt ?? b.closedAt ?? ''),
  );

  const totals = new Map<string, { shiftCount: number; totalMinutes: number }>();
  for (const r of shifts) {
    const t = totals.get(r.employeeId) ?? { shiftCount: 0, totalMinutes: 0 };
    t.shiftCount += 1;
    t.totalMinutes += r.durationMinutes;
    totals.set(r.employeeId, t);
  }

  const byEmployee = [...totals.entries()]
    .map(([employeeId, t]) => ({ employeeId, ...t }))
    .sort((a, b) => b.totalMinutes - a.totalMinutes);

  const totalMinutes = shifts.reduce((s, r) => s + r.durationMinutes, 0);
  return { shifts, byEmployee, totalMinutes };
}

function csvCell(v: string | number | boolean | null): string {
  const s = v === null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * Per-shift CSV export (payroll / TimeWin handoff). Stable header & column
 * order; deterministic row order (matches `summarizeShifts`).
 */
export function shiftsToCsv(summary: ShiftSummary): string {
  const header = [
    'sessionId',
    'employeeId',
    'terminalId',
    'openedAt',
    'closedAt',
    'durationMinutes',
    'open',
  ];
  const lines = [header.join(',')];
  for (const r of summary.shifts) {
    lines.push(
      [
        csvCell(r.sessionId),
        csvCell(r.employeeId),
        csvCell(r.terminalId),
        csvCell(r.openedAt),
        csvCell(r.closedAt),
        csvCell(r.durationMinutes),
        csvCell(r.open),
      ].join(','),
    );
  }
  return lines.join('\n');
}

/** Normalize raw outbox rows into ShiftEvents (tolerant; ignores other types). */
export function toShiftEvents(rows: readonly any[]): ShiftEvent[] {
  const out: ShiftEvent[] = [];
  for (const r of rows ?? []) {
    const type = r?.type;
    const p = r?.payload ?? {};
    const sessionId = String(p.sessionId ?? r?.aggregateId ?? '');
    if (!sessionId) continue;
    if (type === 'cash_session.opened') {
      out.push({
        sessionId,
        employeeId: String(r.employeeId ?? ''),
        terminalId: r.terminalId ?? p.terminalId ?? null,
        kind: 'open',
        at: String(p.openedAt ?? r.occurredAt ?? ''),
      });
    } else if (type === 'employee_activity.recorded' && p.action === 'closed') {
      out.push({
        sessionId,
        employeeId: String(r.employeeId ?? ''),
        terminalId: r.terminalId ?? p.terminalId ?? null,
        kind: 'close',
        at: String(p.closedAt ?? r.occurredAt ?? ''),
        durationMinutes: typeof p.durationMinutes === 'number' ? p.durationMinutes : null,
      });
    }
  }
  return out;
}
