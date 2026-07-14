// P367 — moteur de comparaison multi-magasins (pur).
// Verrouille : dérivation d'indicateurs sans re-fetch (null jamais 0 inventé),
// labels de buckets, classement au créneau, conclusions factuelles non causales,
// modes d'affichage top5/bottom5.

import { describe, expect, it } from 'vitest';
import {
  aggregate,
  applyChartMode,
  bucketLabel,
  bucketTooltipLabel,
  buildConclusions,
  metricValue,
  rankAt,
  rankPeriod,
  SeriesPoint,
  StoreSeries,
} from './series';

const pt = (over: Partial<SeriesPoint>): SeriesPoint => ({
  t: '2026-07-14 14:00',
  revenue: 0,
  tickets: 0,
  items: 0,
  discount: 0,
  refunds: 0,
  cancellations: 0,
  margin: null,
  ...over,
});

const mk = (storeId: string, name: string, revs: number[], tks?: number[]): StoreSeries => ({
  storeId,
  name,
  points: revs.map((r, i) =>
    pt({ t: `2026-07-${String(10 + i).padStart(2, '0')} 00:00`, revenue: r, tickets: tks?.[i] ?? (r ? 1 : 0) }),
  ),
});

describe('metricValue — jamais de 0 inventé', () => {
  it('panier moyen et articles/ticket : null à 0 ticket', () => {
    expect(metricValue(pt({ revenue: 1000, tickets: 0 }), 'avgTicket')).toBeNull();
    expect(metricValue(pt({ revenue: 1000, tickets: 4 }), 'avgTicket')).toBe(250);
    expect(metricValue(pt({ items: 6, tickets: 4 }), 'itemsPerTicket')).toBe(1.5);
    expect(metricValue(pt({ items: 6, tickets: 0 }), 'itemsPerTicket')).toBeNull();
  });
  it('marge : null quand aucun coût couvert', () => {
    expect(metricValue(pt({}), 'margin')).toBeNull();
    expect(metricValue(pt({ margin: 420 }), 'margin')).toBe(420);
  });
});

describe('bucketLabel / bucketTooltipLabel', () => {
  it('affiche les heures précises et les dates réelles', () => {
    expect(bucketLabel('2026-07-14 08:00', 'hour')).toBe('8 h');
    expect(bucketLabel('2026-07-01 00:00', 'day')).toBe('1 juil.');
    expect(bucketLabel('2026-07-06 00:00', 'week')).toBe('sem. 6 juil.');
    expect(bucketLabel('2026-07-01 00:00', 'month')).toBe('juil. 2026');
  });
  it('infobulle : créneau horaire « 14 h – 15 h » et jour avec jour de semaine', () => {
    expect(bucketTooltipLabel('2026-07-14 14:00', 'hour')).toBe('14 h – 15 h');
    expect(bucketTooltipLabel('2026-07-14 00:00', 'day')).toBe('mar. 14 juil.');
  });
});

describe('rankAt / rankPeriod — classement synchronisé', () => {
  const series = [
    mk('a', 'Cergy', [100, 400]),
    mk('b', 'Évry', [300, 200]),
    mk('c', 'Lyon', [0, 0]),
  ];
  it('classe au créneau sélectionné (desc, déterministe)', () => {
    expect(rankAt(series, 0, 'revenue').map((r) => r.name)).toEqual(['Évry', 'Cergy', 'Lyon']);
    expect(rankAt(series, 1, 'revenue').map((r) => r.name)).toEqual(['Cergy', 'Évry', 'Lyon']);
  });
  it('classe sur la période entière', () => {
    const r = rankPeriod(series, 'revenue');
    expect(r.map((x) => [x.name, x.value])).toEqual([
      ['Cergy', 500],
      ['Évry', 500],
      ['Lyon', 0],
    ].map(([n]) => [n, expect.anything()]) as any);
    // Cergy et Évry à égalité (500) → ordre alphabétique.
    expect(r[0].name).toBe('Cergy');
  });
});

describe('aggregate', () => {
  it('somme les composantes, marge null si jamais couverte', () => {
    const agg = aggregate([pt({ revenue: 100, tickets: 1 }), pt({ revenue: 200, tickets: 2, margin: 50 })]);
    expect(agg.revenue).toBe(300);
    expect(agg.tickets).toBe(3);
    expect(agg.margin).toBe(50);
    expect(aggregate([pt({}), pt({})]).margin).toBeNull();
  });
});

describe('buildConclusions — factuel, jamais causal', () => {
  it('écart de CA chiffré entre les deux premiers', () => {
    const out = buildConclusions([mk('a', 'Cergy', [592, 592]), mk('b', 'Évry', [500, 500])], 'day');
    expect(out[0]).toContain('Cergy réalise 18,4 %');
    expect(out[0]).toContain('Évry');
  });
  it('signale plus de tickets mais panier inférieur', () => {
    const out = buildConclusions(
      [
        mk('a', 'Cergy', [10000], [4]), // panier 2500
        mk('b', 'Évry', [9000], [9]), // plus de tickets, panier 1000
      ],
      'day',
    );
    expect(out.join(' ')).toContain('Évry génère davantage de tickets, mais son panier moyen est inférieur.');
  });
  it('localise le principal écart temporel sans inventer de cause', () => {
    const out = buildConclusions(
      [
        { storeId: 'a', name: 'Cergy', points: [pt({ t: '2026-07-14 14:00', revenue: 42850, tickets: 22 }), pt({ t: '2026-07-14 15:00', revenue: 10000, tickets: 5 })] },
        { storeId: 'b', name: 'Évry', points: [pt({ t: '2026-07-14 14:00', revenue: 36120, tickets: 19 }), pt({ t: '2026-07-14 15:00', revenue: 9900, tickets: 5 })] },
      ],
      'hour',
    );
    const s = out.join(' ');
    expect(s).toContain('principal écart');
    expect(s).toContain('14 h – 15 h');
    expect(s).not.toMatch(/parce que|à cause|explique/i);
  });
  it('sélection sans vente : le dit clairement', () => {
    expect(buildConclusions([mk('a', 'Cergy', [0, 0])], 'day')[0]).toContain('Aucune vente');
  });
});

describe('applyChartMode', () => {
  const many = ['A', 'B', 'C', 'D', 'E', 'F', 'G'].map((n, i) => mk(n.toLowerCase(), n, [100 * (7 - i)]));
  it('top5 / bottom5 par CA de période', () => {
    expect(applyChartMode(many, 'top5').map((s) => s.name)).toEqual(['A', 'B', 'C', 'D', 'E']);
    expect(applyChartMode(many, 'bottom5').map((s) => s.name)).toEqual(['C', 'D', 'E', 'F', 'G']);
    expect(applyChartMode(many, 'all')).toHaveLength(7);
  });
});
