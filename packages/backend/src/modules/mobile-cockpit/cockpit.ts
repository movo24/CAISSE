/**
 * POS-110/112 — Mobile supervision cockpit (read-only). Pure shaper (no DB/Nest) that
 * builds the alerts payload from already-fetched stock alerts + open sale anomalies.
 *
 * Read-only by construction: no action is exposed. The endpoint is guarded by the
 * EMPLOYEE JWT + RolesGuard (manager/admin) — NOT the customer mobile token — and is
 * tenant-scoped. This module is the shaping MATH only, fully unit-testable.
 */

import { GuardSeverity } from '../sales-guards/sales-guards.types';

export type CockpitOverall = 'ok' | 'warning' | 'critical';

export interface CockpitStockSource {
  id: string;
  name: string;
  ean: string;
  stockQuantity: number;
}

export interface CockpitAnomalySource {
  id: string;
  code: string;
  severity: GuardSeverity;
  message: string;
  createdAt: Date | string;
}

export interface CockpitInput {
  stockAlert: CockpitStockSource[];
  stockCritical: CockpitStockSource[];
  anomalies: CockpitAnomalySource[];
}

export interface CockpitStockItem extends CockpitStockSource {
  level: 'alert' | 'critical';
}

export interface CockpitAnomaly {
  id: string;
  code: string;
  severity: GuardSeverity;
  message: string;
  createdAt: string;
}

export interface CockpitPayload {
  summary: {
    stockAlertCount: number;
    stockCriticalCount: number;
    anomaliesOpenCount: number;
    overall: CockpitOverall;
  };
  stock: { critical: CockpitStockItem[]; alert: CockpitStockItem[] };
  anomalies: CockpitAnomaly[];
}

export function buildAlertsCockpit(input: CockpitInput): CockpitPayload {
  const critical: CockpitStockItem[] = input.stockCritical.map((p) => ({
    ...p,
    level: 'critical',
  }));
  const alert: CockpitStockItem[] = input.stockAlert.map((p) => ({
    ...p,
    level: 'alert',
  }));
  const anomalies: CockpitAnomaly[] = input.anomalies.map((a) => ({
    id: a.id,
    code: a.code,
    severity: a.severity,
    message: a.message,
    createdAt: new Date(a.createdAt).toISOString(),
  }));

  const hasCritical =
    critical.length > 0 || anomalies.some((a) => a.severity === 'critical');
  const hasWarning =
    alert.length > 0 || anomalies.some((a) => a.severity === 'warning');
  const overall: CockpitOverall = hasCritical
    ? 'critical'
    : hasWarning
      ? 'warning'
      : 'ok';

  return {
    summary: {
      stockAlertCount: alert.length,
      stockCriticalCount: critical.length,
      anomaliesOpenCount: anomalies.length,
      overall,
    },
    stock: { critical, alert },
    anomalies,
  };
}
