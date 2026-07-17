import { describe, it, expect } from 'vitest';
import { WedgeDecoder, barcodeFormat, isEditableTarget } from './wedgeDecoder';

/** Simule la séquence clavier d'une douchette : chaque caractère à `gapMs`, puis Entrée. */
function scan(decoder: WedgeDecoder, code: string, gapMs: number, start = 1000) {
  let t = start;
  for (const ch of code) {
    const r = decoder.feed(ch, t);
    expect(r).toBeNull(); // aucun code tant que Entrée n'est pas reçue
    t += gapMs;
  }
  return decoder.feed('Enter', t);
}

describe('WedgeDecoder — séquence clavier douchette (Lenvii E655)', () => {
  it('scan rapide EAN-13 + Entrée → code décodé', () => {
    const d = new WedgeDecoder();
    const r = scan(d, '3760012345678', 5); // 5 ms entre caractères = douchette
    expect(r).toEqual({ code: '3760012345678', format: 'EAN-13' });
  });

  it('reconnaît EAN-8, UPC-A (12), GTIN-14', () => {
    expect(scan(new WedgeDecoder(), '20123452', 4)).toEqual({ code: '20123452', format: 'EAN-8' });
    expect(scan(new WedgeDecoder(), '012345678905', 4)).toEqual({ code: '012345678905', format: 'UPC-A' });
    expect(scan(new WedgeDecoder(), '01234567890128', 4)).toEqual({ code: '01234567890128', format: 'GTIN-14' });
  });

  it('code interne court (≥4) accepté en CODE-128', () => {
    expect(scan(new WedgeDecoder(), 'ABC12', 4)).toEqual({ code: 'ABC12', format: 'CODE-128' });
  });

  it('saisie HUMAINE lente (écarts > seuil) → aucun scan', () => {
    const d = new WedgeDecoder();
    let t = 0;
    for (const ch of '12345') { expect(d.feed(ch, t)).toBeNull(); t += 250; } // 250 ms = humain
    // À l'Entrée, le tampon a été réinitialisé à chaque écart → au plus 1 caractère.
    expect(d.feed('Enter', t)).toBeNull();
  });

  it('Entrée avec tampon trop court (<4) → pas un scan', () => {
    const d = new WedgeDecoder();
    const r = scan(d, 'AB', 4);
    expect(r).toBeNull();
  });

  it('deux scans rapides successifs → deux codes distincts', () => {
    const d = new WedgeDecoder();
    expect(scan(d, '1111111111116', 5, 1000)).toEqual({ code: '1111111111116', format: 'EAN-13' });
    expect(scan(d, '2222222222227', 5, 2000)).toEqual({ code: '2222222222227', format: 'EAN-13' });
  });

  it('touches de modification (Shift) n\'altèrent pas le code', () => {
    const d = new WedgeDecoder();
    let t = 1000;
    for (const ch of '376001') { d.feed(ch, t); t += 5; }
    d.feed('Shift', t); t += 5; // modificateur ignoré, tampon conservé
    for (const ch of '2345678') { d.feed(ch, t); t += 5; }
    expect(d.feed('Enter', t)).toEqual({ code: '3760012345678', format: 'EAN-13' });
  });

  it('barcodeFormat', () => {
    expect(barcodeFormat('12345678')).toBe('EAN-8');
    expect(barcodeFormat('1234567890123')).toBe('EAN-13');
    expect(barcodeFormat('XYZ')).toBe('CODE-128');
  });
});

describe('isEditableTarget — champ actif : la douchette globale ne capture pas (scénario 5)', () => {
  it('INPUT / TEXTAREA / SELECT / contentEditable → éditable (frappe laissée au champ)', () => {
    expect(isEditableTarget({ tagName: 'INPUT' })).toBe(true);
    expect(isEditableTarget({ tagName: 'TEXTAREA' })).toBe(true);
    expect(isEditableTarget({ tagName: 'SELECT' })).toBe(true);
    expect(isEditableTarget({ tagName: 'DIV', isContentEditable: true })).toBe(true);
  });

  it('éléments non éditables → capture globale possible', () => {
    expect(isEditableTarget({ tagName: 'DIV' })).toBe(false);
    expect(isEditableTarget({ tagName: 'BODY' })).toBe(false);
    expect(isEditableTarget(null)).toBe(false);
  });
});
