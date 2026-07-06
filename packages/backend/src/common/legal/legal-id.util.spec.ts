import {
  isValidLuhn,
  isValidSiren,
  isValidSiret,
  sirenFromSiret,
  frenchVatNumber,
  reconcileLegalIds,
  digitsOnly,
} from './legal-id.util';

// Luhn-valid fixtures.
const SIREN = '732829320';
const SIRET = '73282932000017'; // starts with SIREN, Luhn-valid

describe('digitsOnly + isValidLuhn', () => {
  it('strips non-digits', () => {
    expect(digitsOnly('732 829 320')).toBe('732829320');
    expect(digitsOnly('FR40 404833048')).toBe('40404833048');
  });
  it('validates Luhn', () => {
    expect(isValidLuhn(SIREN)).toBe(true);
    expect(isValidLuhn('732829321')).toBe(false);
    expect(isValidLuhn('abc')).toBe(false);
  });
});

describe('isValidSiren / isValidSiret', () => {
  it('SIREN must be 9 digits + Luhn', () => {
    expect(isValidSiren(SIREN)).toBe(true);
    expect(isValidSiren('73282932')).toBe(false); // 8 digits
    expect(isValidSiren('732829321')).toBe(false); // bad checksum
    expect(isValidSiren('732 829 320')).toBe(true); // spaces tolerated
  });
  it('SIRET must be 14 digits + Luhn', () => {
    expect(isValidSiret(SIRET)).toBe(true);
    expect(isValidSiret('7328293200001')).toBe(false); // 13 digits
    expect(isValidSiret('73282932000018')).toBe(false); // bad checksum
  });
  it('accepts the La Poste SIRET Luhn exception', () => {
    expect(isValidSiret('35600000000048')).toBe(true); // SIREN 356000000
  });
});

describe('sirenFromSiret / frenchVatNumber', () => {
  it('derives the SIREN from a SIRET', () => {
    expect(sirenFromSiret(SIRET)).toBe(SIREN);
    expect(sirenFromSiret('123')).toBeNull();
  });
  it('builds a French VAT number for a valid SIREN', () => {
    const vat = frenchVatNumber(SIREN);
    expect(vat).toMatch(/^FR\d{2}732829320$/);
    expect(frenchVatNumber('123')).toBeNull();
  });
});

describe('reconcileLegalIds', () => {
  it('accepts a consistent SIREN + SIRET', () => {
    const r = reconcileLegalIds({ siren: SIREN, siret: SIRET, vatNumber: 'FR12732829320' });
    expect(r.errors).toEqual([]);
    expect(r.siren).toBe(SIREN);
    expect(r.siret).toBe(SIRET);
  });

  it('auto-fills the SIREN from the SIRET when the SIREN is empty', () => {
    const r = reconcileLegalIds({ siren: '', siret: SIRET });
    expect(r.siren).toBe(SIREN);
    expect(r.errors).toEqual([]);
  });

  it('errors when the SIRET does not start with the SIREN', () => {
    const r = reconcileLegalIds({ siren: SIREN, siret: '99999999900017' });
    expect(r.errors.some((e) => /commencer par le SIREN/.test(e))).toBe(true);
  });

  it('errors on a 9-digit-wrong SIREN', () => {
    const r = reconcileLegalIds({ siren: '12345678', siret: '' });
    expect(r.errors.some((e) => /9 chiffres/.test(e))).toBe(true);
  });

  it('errors on a bad SIREN checksum', () => {
    const r = reconcileLegalIds({ siren: '732829321' });
    expect(r.errors.some((e) => /clé de contrôle/.test(e))).toBe(true);
  });

  it('errors on a 14-digit-wrong SIRET length', () => {
    const r = reconcileLegalIds({ siret: '7328293200001' });
    expect(r.errors.some((e) => /14 chiffres/.test(e))).toBe(true);
  });

  it('warns when a French company with a valid SIREN has no VAT number', () => {
    const r = reconcileLegalIds({ siren: SIREN, isFrench: true });
    expect(r.warnings.some((w) => /TVA/.test(w))).toBe(true);
    expect(r.errors).toEqual([]); // never blocking
  });

  it('does not warn when TVA is provided', () => {
    const r = reconcileLegalIds({ siren: SIREN, vatNumber: 'FR12732829320', isFrench: true });
    expect(r.warnings).toEqual([]);
  });

  it('does not warn for a non-French company', () => {
    const r = reconcileLegalIds({ siren: SIREN, isFrench: false });
    expect(r.warnings).toEqual([]);
  });
});
