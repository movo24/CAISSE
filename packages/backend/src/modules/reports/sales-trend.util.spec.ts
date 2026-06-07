import { compareBaselines, forecastNextDay, DailyCaMap } from './sales-trend.util';

describe('sales-trend.util — comparaisons baselines', () => {
  // Référence : mardi 2026-06-09
  const TODAY = '2026-06-09';
  const map: DailyCaMap = {
    '2026-06-09': 10000, // today
    '2026-06-08': 8000,  // J-1
    '2026-06-02': 5000,  // S-1 (même mardi)
    '2026-05-09': 20000, // M-1
    '2025-06-09': 4000,  // N-1
  };

  it('calcule les variations vs J-1/S-1/M-1/N-1', () => {
    const c = compareBaselines(map, TODAY);
    expect(c.today.caMinorUnits).toBe(10000);
    expect(c.jMinus1).toMatchObject({ date: '2026-06-08', caMinorUnits: 8000, deltaPct: 25 }); // +25%
    expect(c.sMinus1).toMatchObject({ date: '2026-06-02', caMinorUnits: 5000, deltaPct: 100 }); // +100%
    expect(c.mMinus1).toMatchObject({ date: '2026-05-09', caMinorUnits: 20000, deltaPct: -50 }); // -50%
    expect(c.nMinus1).toMatchObject({ date: '2025-06-09', caMinorUnits: 4000, deltaPct: 150 }); // +150%
  });

  it('gère un baseline absent (=0) sans crasher', () => {
    const c = compareBaselines({ '2026-06-09': 10000 }, TODAY);
    expect(c.jMinus1.caMinorUnits).toBe(0);
    expect(c.jMinus1.deltaPct).toBe(100); // base 0, today > 0 → +100% conventionnel
  });
});

describe('sales-trend.util — prévision simple', () => {
  it('utilise la moyenne des mêmes jours de semaine quand dispo', () => {
    // lastKnown = lundi 2026-06-08 → target = mardi 2026-06-09
    // mardis précédents : 06-02, 05-26, 05-19, 05-12
    const map: DailyCaMap = {
      '2026-06-02': 6000, '2026-05-26': 4000, '2026-05-19': 5000, '2026-05-12': 5000,
      '2026-06-08': 9999,
    };
    const f = forecastNextDay(map, '2026-06-08');
    expect(f.date).toBe('2026-06-09');
    expect(f.method).toBe('weekday-average');
    expect(f.sampleSize).toBe(4);
    expect(f.predictedMinorUnits).toBe(5000); // (6000+4000+5000+5000)/4
  });

  it('repli sur moyenne mobile 7j si pas assez de mêmes jours de semaine', () => {
    const map: DailyCaMap = {
      '2026-06-08': 1000, '2026-06-07': 2000, '2026-06-06': 3000,
    };
    const f = forecastNextDay(map, '2026-06-08');
    expect(f.method).toBe('moving-average-7');
    expect(f.predictedMinorUnits).toBe(2000); // (1000+2000+3000)/3
  });

  it('signale données insuffisantes', () => {
    const f = forecastNextDay({}, '2026-06-08');
    expect(f.method).toBe('insufficient-data');
    expect(f.predictedMinorUnits).toBe(0);
  });
});
