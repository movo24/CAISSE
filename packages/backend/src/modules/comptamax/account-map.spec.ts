import {
  resolveAccountMap,
  paymentAccount,
  buildSaleJournalLines,
  ACCOUNTS,
} from './pre-accounting';

describe('Comptamax configurable account map (POS-INT-101)', () => {
  it('returns the default PCG plan when no override is given', () => {
    expect(resolveAccountMap()).toEqual({ ...ACCOUNTS });
    expect(resolveAccountMap({})).toEqual({ ...ACCOUNTS });
  });

  it('overrides only known keys with non-empty string codes', () => {
    const map = resolveAccountMap({ VENTE_HT: '700001', CAISSE_ESPECES: '530001' });
    expect(map.VENTE_HT).toBe('700001');
    expect(map.CAISSE_ESPECES).toBe('530001');
    // untouched keys keep their default
    expect(map.TVA_COLLECTEE).toBe(ACCOUNTS.TVA_COLLECTEE);
  });

  it('ignores malformed values (never produces an invalid account)', () => {
    const map = resolveAccountMap({
      VENTE_HT: '',
      TVA_COLLECTEE: '   ',
      CAISSE_ESPECES: 42 as unknown as string,
      UNKNOWN_KEY: '999',
    } as Record<string, unknown>);
    expect(map.VENTE_HT).toBe(ACCOUNTS.VENTE_HT);
    expect(map.TVA_COLLECTEE).toBe(ACCOUNTS.TVA_COLLECTEE);
    expect(map.CAISSE_ESPECES).toBe(ACCOUNTS.CAISSE_ESPECES);
    expect((map as Record<string, string>).UNKNOWN_KEY).toBeUndefined();
  });

  it('trims override codes', () => {
    expect(resolveAccountMap({ VENTE_HT: '  700001  ' }).VENTE_HT).toBe('700001');
  });

  it('paymentAccount honours the supplied map', () => {
    const map = resolveAccountMap({ CAISSE_ESPECES: '530009', BANQUE_CARTE: '512009' });
    expect(paymentAccount('cash', map)).toBe('530009');
    expect(paymentAccount('card', map)).toBe('512009');
    expect(paymentAccount('cash')).toBe(ACCOUNTS.CAISSE_ESPECES); // default unchanged
  });

  it('buildSaleJournalLines books on the custom accounts and stays balanced', () => {
    const map = resolveAccountMap({ VENTE_HT: '700001', CAISSE_ESPECES: '530001' });
    const lines = buildSaleJournalLines(
      {
        ticketNumber: 'T1',
        totalMinorUnits: 1200,
        taxTotalMinorUnits: 200,
        payments: [{ method: 'cash', amountMinorUnits: 1200 }],
      },
      map,
    );
    const debit = lines.find((l) => l.debitMinorUnits > 0);
    const venteHt = lines.find((l) => l.account === '700001');
    expect(debit?.account).toBe('530001');
    expect(venteHt?.creditMinorUnits).toBe(1000);
    const totDebit = lines.reduce((s, l) => s + l.debitMinorUnits, 0);
    const totCredit = lines.reduce((s, l) => s + l.creditMinorUnits, 0);
    expect(totDebit).toBe(totCredit);
  });
});
