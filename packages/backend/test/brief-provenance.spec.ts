/**
 * Étage 3 — provenance guard (the structural INV-3 test, built BEFORE the renderer
 * it guards). DECISIVE adverse: a brief containing one number not traceable to the
 * findings is INVALID. Format variants (centimes→euros, FR/EN separators, dropped
 * sign, date parts) must trace; fabrications must not.
 */
import { verifyBriefProvenance } from '../src/modules/ai-brief/brief-provenance.util';
import { BriefFindings } from '../src/modules/ai-brief/brief-findings.service';

const FINDINGS: BriefFindings = {
  businessDay: '2026-06-12',
  scope: { storeCount: 2 },
  totals: {
    caBrutMinor: 123456, // 1 234,56 €
    netMinor: 119000,
    txCount: 42,
    voidCount: 3,
    returnsAmountMinor: 4456,
    discountTotalMinor: 1500, // 15,00 €
    targetMinor: 200000,
    targetReachedPct: 61.7,
    presentCount: 5,
    expectedCount: 6,
    openSessions: 3,
    activeTerminals: 4,
    ruptureCount: 1,
    lowStockCount: 2,
    alertCount: 2,
  },
  stores: [
    { storeId: 'a', name: 'Alpha', caBrutMinor: 100000, netMinor: 98000, txCount: 30, voidCount: 2, ruptureCount: 1, lowStockCount: 2, presentCount: 3, expectedCount: 3, deltaVsPrevDayPct: -12.3, deltaVsSameWeekdayPct: 8 },
  ],
  alerts: [{ storeId: 'a', rule: 'void_rate', thresholdBand: 'warning', businessDay: '2026-06-12' }],
  computedAt: '2026-06-12T09:00:00.000Z',
};

describe('Étage 3 — brief provenance guard (INV-3 structural)', () => {
  it('DECISIVE ADVERSE — one fabricated number → INVALID, never servable', () => {
    const r = verifyBriefProvenance(FINDINGS, 'Le CA du jour atteint 9 999,99 € sur 42 tickets.');
    expect(r.valid).toBe(false);
    expect(r.untraceable).toEqual(['9 999,99']);
  });

  it('faithful prose traces — centimes→euros, percents, counts, date parts', () => {
    const text =
      'Brief du 2026-06-12 : CA brut 1 234,56 € pour 42 tickets (3 annulations). ' +
      'Objectif 2000,00 € atteint à 61,7%. Remises 15,00 €. 5/6 présents, 3 sessions, 1 rupture, 2 alertes.';
    const r = verifyBriefProvenance(FINDINGS, text);
    expect(r.untraceable).toEqual([]);
    expect(r.valid).toBe(true);
  });

  it('a dropped sign still traces (prose says "en baisse de 12,3%")', () => {
    expect(verifyBriefProvenance(FINDINGS, 'Alpha en baisse de 12,3% vs la veille.').valid).toBe(true);
  });

  it('EN-format separators trace too ("1,234.56")', () => {
    expect(verifyBriefProvenance(FINDINGS, 'Gross revenue 1,234.56 for the day.').valid).toBe(true);
  });

  it('ADVERSE — a subtly wrong figure (1 234,57) is caught', () => {
    const r = verifyBriefProvenance(FINDINGS, 'CA brut 1 234,57 €.');
    expect(r.valid).toBe(false);
    expect(r.untraceable).toEqual(['1 234,57']);
  });

  it('numberless prose is trivially valid', () => {
    expect(verifyBriefProvenance(FINDINGS, 'Journée calme, rien à signaler.').valid).toBe(true);
  });

  it('digits embedded in SOURCED strings trace (store name "B43" quoted in prose)', () => {
    const withB43: BriefFindings = { ...FINDINGS, stores: [{ ...FINDINGS.stores[0], name: 'Grand Littoral B43' }] };
    expect(verifyBriefProvenance(withB43, 'B43 réalise 30 tickets.').valid).toBe(true);
    // …but an unsourced number still fails alongside it:
    expect(verifyBriefProvenance(withB43, 'B43 réalise 77 tickets.').valid).toBe(false);
  });
});
