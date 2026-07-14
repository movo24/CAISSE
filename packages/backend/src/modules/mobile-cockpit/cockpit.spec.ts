import { buildAlertsCockpit } from './cockpit';

describe('POS-110/112 buildAlertsCockpit (read-only shaper)', () => {
  const stock = (id: string, q: number) => ({ id, name: `P${id}`, ean: `E${id}`, stockQuantity: q });

  it('empty inputs = overall ok', () => {
    const p = buildAlertsCockpit({ stockAlert: [], stockCritical: [], anomalies: [] });
    expect(p.summary.overall).toBe('ok');
    expect(p.summary.stockAlertCount).toBe(0);
    expect(p.summary.anomaliesOpenCount).toBe(0);
  });

  it('stock alert only = warning', () => {
    const p = buildAlertsCockpit({ stockAlert: [stock('1', 3)], stockCritical: [], anomalies: [] });
    expect(p.summary.overall).toBe('warning');
    expect(p.stock.alert[0].level).toBe('alert');
  });

  it('stock critical = critical', () => {
    const p = buildAlertsCockpit({ stockAlert: [], stockCritical: [stock('1', 0)], anomalies: [] });
    expect(p.summary.overall).toBe('critical');
    expect(p.stock.critical[0].level).toBe('critical');
  });

  it('critical anomaly raises overall to critical', () => {
    const p = buildAlertsCockpit({
      stockAlert: [],
      stockCritical: [],
      anomalies: [
        { id: 'a', code: 'EXCESSIVE_DISCOUNT', severity: 'critical', message: 'x', createdAt: '2026-06-28T10:00:00Z' },
      ],
    });
    expect(p.summary.overall).toBe('critical');
    expect(p.summary.anomaliesOpenCount).toBe(1);
    expect(p.anomalies[0].createdAt).toBe('2026-06-28T10:00:00.000Z');
  });

  it('warning anomaly only = warning', () => {
    const p = buildAlertsCockpit({
      stockAlert: [],
      stockCritical: [],
      anomalies: [{ id: 'a', code: 'C', severity: 'warning', message: 'm', createdAt: new Date() }],
    });
    expect(p.summary.overall).toBe('warning');
  });

  it('counts reflect inputs', () => {
    const p = buildAlertsCockpit({
      stockAlert: [stock('1', 3), stock('2', 4)],
      stockCritical: [stock('3', 0)],
      anomalies: [{ id: 'a', code: 'C', severity: 'warning', message: 'm', createdAt: new Date() }],
    });
    expect(p.summary.stockAlertCount).toBe(2);
    expect(p.summary.stockCriticalCount).toBe(1);
    expect(p.summary.anomaliesOpenCount).toBe(1);
    expect(p.summary.overall).toBe('critical'); // critical stock present
  });
});
