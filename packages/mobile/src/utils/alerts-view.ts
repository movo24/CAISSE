/**
 * P361 — POS-110 : view-model PUR de l'écran alertes du cockpit mobile.
 * Consomme le payload de `GET /api/mobile/v1/alerts` (shaper backend
 * `mobile-cockpit/cockpit.ts`, testé 6/6) et prépare TOUT ce que l'UI affiche :
 * normalisation défensive (payload partiel/offline → défauts sûrs), badge
 * global, tri des anomalies, sections ordonnées par gravité.
 * Lecture seule par construction — aucune action n'existe dans ce modèle.
 */

export type Overall = 'ok' | 'warning' | 'critical';

export interface StockItemVM {
  id: string;
  name: string;
  ean: string;
  stockQuantity: number;
  level: 'alert' | 'critical';
}

export interface AnomalyVM {
  id: string;
  code: string;
  severity: 'info' | 'warning' | 'critical';
  message: string;
  createdAt: string; // ISO
}

export interface AlertsPayloadVM {
  summary: {
    stockAlertCount: number;
    stockCriticalCount: number;
    anomaliesOpenCount: number;
    overall: Overall;
  };
  stock: { critical: StockItemVM[]; alert: StockItemVM[] };
  anomalies: AnomalyVM[];
}

/** Normalisation défensive : tout champ absent/malformé → défaut sûr. */
export function safeAlertsPayload(raw: unknown): AlertsPayloadVM {
  const r = (raw ?? {}) as any;
  const stockCritical: StockItemVM[] = Array.isArray(r?.stock?.critical) ? r.stock.critical : [];
  const stockAlert: StockItemVM[] = Array.isArray(r?.stock?.alert) ? r.stock.alert : [];
  const anomalies: AnomalyVM[] = Array.isArray(r?.anomalies) ? r.anomalies : [];

  const declared: unknown = r?.summary?.overall;
  const overall: Overall =
    declared === 'ok' || declared === 'warning' || declared === 'critical'
      ? declared
      : // recalcul depuis les données si le champ manque — même règle que le backend
        stockCritical.length > 0 || anomalies.some((a) => a?.severity === 'critical')
        ? 'critical'
        : stockAlert.length > 0 || anomalies.some((a) => a?.severity === 'warning')
          ? 'warning'
          : 'ok';

  return {
    summary: {
      stockAlertCount: Number(r?.summary?.stockAlertCount ?? stockAlert.length) || stockAlert.length,
      stockCriticalCount: Number(r?.summary?.stockCriticalCount ?? stockCritical.length) || stockCritical.length,
      anomaliesOpenCount: Number(r?.summary?.anomaliesOpenCount ?? anomalies.length) || anomalies.length,
      overall,
    },
    stock: { critical: stockCritical, alert: stockAlert },
    anomalies,
  };
}

export interface BadgeVM {
  tone: Overall;
  label: string;
}

export function overallBadge(overall: Overall): BadgeVM {
  switch (overall) {
    case 'critical':
      return { tone: 'critical', label: 'Intervention requise' };
    case 'warning':
      return { tone: 'warning', label: 'À surveiller' };
    default:
      return { tone: 'ok', label: 'Tout va bien' };
  }
}

const SEVERITY_RANK: Record<AnomalyVM['severity'], number> = {
  critical: 0,
  warning: 1,
  info: 2,
};

/** Tri stable : gravité d'abord, puis plus récent en premier, puis id (déterministe). */
export function sortAnomalies(anomalies: AnomalyVM[]): AnomalyVM[] {
  return [...anomalies].sort(
    (a, b) =>
      SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
      String(b.createdAt).localeCompare(String(a.createdAt)) ||
      a.id.localeCompare(b.id),
  );
}

export interface SectionVM {
  key: 'stock-critical' | 'anomalies' | 'stock-alert';
  title: string;
  count: number;
  tone: Overall;
}

/** Sections dans l'ordre d'affichage — les sections vides sont OMISES. */
export function alertSections(p: AlertsPayloadVM): SectionVM[] {
  const out: SectionVM[] = [];
  if (p.stock.critical.length > 0) {
    out.push({ key: 'stock-critical', title: 'Stock critique', count: p.stock.critical.length, tone: 'critical' });
  }
  if (p.anomalies.length > 0) {
    const tone: Overall = p.anomalies.some((a) => a.severity === 'critical') ? 'critical' : 'warning';
    out.push({ key: 'anomalies', title: 'Anomalies de vente', count: p.anomalies.length, tone });
  }
  if (p.stock.alert.length > 0) {
    out.push({ key: 'stock-alert', title: 'Stock bas', count: p.stock.alert.length, tone: 'warning' });
  }
  return out;
}
