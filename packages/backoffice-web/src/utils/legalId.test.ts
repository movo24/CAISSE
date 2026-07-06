import { describe, it, expect } from 'vitest';
import { isValidSiren, isValidSiret, sirenFromSiret, checkLegalIds } from './legalId';

const SIREN = '732829320';
const SIRET = '73282932000017';

describe('isValidSiren / isValidSiret', () => {
  it('validates SIREN (9 digits + Luhn)', () => {
    expect(isValidSiren(SIREN)).toBe(true);
    expect(isValidSiren('732829321')).toBe(false);
    expect(isValidSiren('12345678')).toBe(false);
  });
  it('validates SIRET (14 digits + Luhn) with La Poste exception', () => {
    expect(isValidSiret(SIRET)).toBe(true);
    expect(isValidSiret('73282932000018')).toBe(false);
    expect(isValidSiret('35600000000048')).toBe(true);
  });
  it('derives SIREN from SIRET', () => {
    expect(sirenFromSiret(SIRET)).toBe(SIREN);
  });
});

describe('checkLegalIds', () => {
  it('passes for a consistent pair', () => {
    const r = checkLegalIds(SIREN, SIRET);
    expect(r.sirenError).toBeNull();
    expect(r.siretError).toBeNull();
  });
  it('auto-fills SIREN from SIRET', () => {
    const r = checkLegalIds('', SIRET);
    expect(r.siren).toBe(SIREN);
    expect(r.sirenAutoFilled).toBe(true);
  });
  it('flags a SIRET not starting with the SIREN', () => {
    const r = checkLegalIds(SIREN, '99999999900017');
    expect(r.siretError).toMatch(/commencer par le SIREN/);
  });
  it('flags a bad SIREN', () => {
    expect(checkLegalIds('732829321', '').sirenError).toMatch(/clé de contrôle/);
    expect(checkLegalIds('123', '').sirenError).toMatch(/9 chiffres/);
  });
});
