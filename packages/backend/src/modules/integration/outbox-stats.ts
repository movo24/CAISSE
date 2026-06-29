/**
 * POS — Outbox stats shaping (pure, unit-testable).
 * Turns grouped (status,type,count) rows into an ops view: totals per status and
 * per type, plus a backlog flag. Used by the monitoring endpoint.
 */

export interface GroupedCount {
  status: string;
  type: string;
  count: number;
}

export interface OutboxStats {
  total: number;
  byStatus: Record<string, number>;
  byType: Record<string, number>;
  backlog: number; // pending + failed (not yet published)
}

export function shapeOutboxStats(rows: GroupedCount[]): OutboxStats {
  const byStatus: Record<string, number> = {};
  const byType: Record<string, number> = {};
  let total = 0;
  for (const r of rows) {
    const c = Number(r.count) || 0;
    total += c;
    byStatus[r.status] = (byStatus[r.status] ?? 0) + c;
    byType[r.type] = (byType[r.type] ?? 0) + c;
  }
  const backlog = (byStatus['pending'] ?? 0) + (byStatus['failed'] ?? 0);
  return { total, byStatus, byType, backlog };
}
