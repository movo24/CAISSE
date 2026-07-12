import { describe, it, expect } from 'vitest';
import {
  drawerKickBytes,
  fullCutBytes,
  partialCutBytes,
  concatBytes,
  toHex,
} from './escpos';

describe('escpos — drawerKickBytes', () => {
  it('ESC p 0 (pin 0) = 1B 70 00 19 FA', () => {
    expect(Array.from(drawerKickBytes(0))).toEqual([0x1b, 0x70, 0x00, 0x19, 0xfa]);
  });
  it('pin 1 change uniquement le 3ᵉ octet', () => {
    expect(Array.from(drawerKickBytes(1))).toEqual([0x1b, 0x70, 0x01, 0x19, 0xfa]);
  });
  it('défaut = pin 0', () => {
    expect(toHex(drawerKickBytes())).toBe('1B 70 00 19 FA');
  });
});

describe('escpos — coupe', () => {
  it('coupe totale = GS V 0', () => {
    expect(Array.from(fullCutBytes())).toEqual([0x1d, 0x56, 0x00]);
  });
  it('coupe partielle = GS V 1', () => {
    expect(Array.from(partialCutBytes())).toEqual([0x1d, 0x56, 0x01]);
  });
});

describe('escpos — concatBytes / toHex', () => {
  it('concatène dans l’ordre', () => {
    const out = concatBytes(drawerKickBytes(), fullCutBytes());
    expect(out.length).toBe(8);
    expect(toHex(out)).toBe('1B 70 00 19 FA 1D 56 00');
  });
  it('vide → buffer vide', () => {
    expect(concatBytes().length).toBe(0);
  });
});
