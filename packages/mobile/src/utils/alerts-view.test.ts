/** P361 — POS-110 : view-model alertes cockpit (pur, lecture seule). */
import { describe, it, expect } from 'vitest';
import {
  safeAlertsPayload,
  overallBadge,
  sortAnomalies,
  alertSections,
  AnomalyVM,
} from './alerts-view';

const anomaly = (o: Partial<AnomalyVM> & { id: string }): AnomalyVM => ({
  code: 'X', severity: 'warning', message: 'm', createdAt: '2026-07-02T10:00:00Z', ...o,
});

describe('safeAlertsPayload — normalisation défensive', () => {
  it('payload complet : repris tel quel', () => {
    const p = safeAlertsPayload({
      summary: { stockAlertCount: 1, stockCriticalCount: 2, anomaliesOpenCount: 3, overall: 'critical' },
      stock: { critical: [{ id: 'c1' }], alert: [{ id: 'a1' }] },
      anomalies: [anomaly({ id: 'x1' })],
    });
    expect(p.summary.overall).toBe('critical');
    expect(p.stock.critical).toHaveLength(1);
  });

  it('payload vide/null/malformé → défauts sûrs, overall=ok (jamais de crash offline)', () => {
    for (const raw of [null, undefined, {}, { stock: 'oops' }, { anomalies: 42 }]) {
      const p = safeAlertsPayload(raw);
      expect(p.summary.overall).toBe('ok');
      expect(p.stock.critical).toEqual([]);
      expect(p.anomalies).toEqual([]);
    }
  });

  it('overall absent → recalculé depuis les données (même règle que le backend)', () => {
    expect(safeAlertsPayload({ stock: { critical: [{ id: 'c' }], alert: [] } }).summary.overall).toBe('critical');
    expect(safeAlertsPayload({ stock: { critical: [], alert: [{ id: 'a' }] } }).summary.overall).toBe('warning');
    expect(safeAlertsPayload({ anomalies: [anomaly({ id: 'x', severity: 'critical' })] }).summary.overall).toBe('critical');
  });
});

describe('overallBadge', () => {
  it('mappe les 3 états sur un ton + libellé FR', () => {
    expect(overallBadge('ok')).toEqual({ tone: 'ok', label: 'Tout va bien' });
    expect(overallBadge('warning').label).toBe('À surveiller');
    expect(overallBadge('critical').label).toBe('Intervention requise');
  });
});

describe('sortAnomalies — gravité puis récence, déterministe', () => {
  it('critical avant warning avant info ; plus récent en premier à gravité égale', () => {
    const sorted = sortAnomalies([
      anomaly({ id: 'w-old', severity: 'warning', createdAt: '2026-07-01T09:00:00Z' }),
      anomaly({ id: 'i1', severity: 'info' }),
      anomaly({ id: 'c1', severity: 'critical', createdAt: '2026-07-01T08:00:00Z' }),
      anomaly({ id: 'w-new', severity: 'warning', createdAt: '2026-07-02T09:00:00Z' }),
    ]);
    expect(sorted.map((a) => a.id)).toEqual(['c1', 'w-new', 'w-old', 'i1']);
  });

  it('ne mute pas l’entrée et départage par id (ordre total)', () => {
    const input = [anomaly({ id: 'b' }), anomaly({ id: 'a' })];
    const out = sortAnomalies(input);
    expect(out.map((a) => a.id)).toEqual(['a', 'b']);
    expect(input.map((a) => a.id)).toEqual(['b', 'a']); // intact
  });
});

describe('alertSections — ordre par gravité, sections vides omises', () => {
  it('les 3 sections dans l’ordre, tons corrects', () => {
    const p = safeAlertsPayload({
      stock: { critical: [{ id: 'c' }], alert: [{ id: 'a' }] },
      anomalies: [anomaly({ id: 'x', severity: 'critical' })],
    });
    expect(alertSections(p)).toEqual([
      { key: 'stock-critical', title: 'Stock critique', count: 1, tone: 'critical' },
      { key: 'anomalies', title: 'Anomalies de vente', count: 1, tone: 'critical' },
      { key: 'stock-alert', title: 'Stock bas', count: 1, tone: 'warning' },
    ]);
  });

  it('tout vide → aucune section (l’UI affiche l’état "Tout va bien")', () => {
    expect(alertSections(safeAlertsPayload({}))).toEqual([]);
  });
});
