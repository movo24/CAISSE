import { describe, it, expect } from 'vitest';
import { WedgeDecoder, barcodeFormat, isEditableTarget, type WedgeFeed } from './wedgeDecoder';

/**
 * Simule la séquence clavier d'une douchette : chaque caractère à `gapMs`, puis Entrée.
 * Renvoie { actions, final } où `actions` = actions par caractère (hors Entrée).
 */
function scan(decoder: WedgeDecoder, code: string, gapMs: number, start = 1000): {
  actions: WedgeFeed['kind'][];
  final: WedgeFeed;
} {
  let t = start;
  const actions: WedgeFeed['kind'][] = [];
  for (const ch of code) {
    actions.push(decoder.feed(ch, t).kind);
    t += gapMs;
  }
  return { actions, final: decoder.feed('Enter', t) };
}

describe('WedgeDecoder — séquence clavier douchette (Lenvii E655)', () => {
  it('scan rapide EAN-13 → Entrée = scan ; 1er car. passthrough, suivants avalés', () => {
    const { actions, final } = scan(new WedgeDecoder(), '3760012345678', 5);
    expect(final).toEqual({ kind: 'scan', code: '3760012345678', format: 'EAN-13' });
    expect(actions[0]).toBe('passthrough'); // 1er caractère (timing inconnu)
    expect(actions.slice(1).every((a) => a === 'swallow')).toBe(true); // rafale avalée
  });

  it('reconnaît EAN-8, UPC-A (12), GTIN-14', () => {
    expect(scan(new WedgeDecoder(), '20123452', 4).final).toMatchObject({ kind: 'scan', format: 'EAN-8' });
    expect(scan(new WedgeDecoder(), '012345678905', 4).final).toMatchObject({ kind: 'scan', format: 'UPC-A' });
    expect(scan(new WedgeDecoder(), '01234567890128', 4).final).toMatchObject({ kind: 'scan', format: 'GTIN-14' });
  });

  it('code interne court (≥4) accepté en CODE-128', () => {
    expect(scan(new WedgeDecoder(), 'ABC12', 4).final).toEqual({ kind: 'scan', code: 'ABC12', format: 'CODE-128' });
  });

  it('saisie HUMAINE lente → tout passthrough, Entrée = none (aucun scan, rien avalé)', () => {
    const d = new WedgeDecoder();
    let t = 0;
    const actions: string[] = [];
    for (const ch of '12345') { actions.push(d.feed(ch, t).kind); t += 250; } // 250 ms = humain
    expect(actions.every((a) => a === 'passthrough')).toBe(true); // le clavier normal fonctionne
    expect(d.feed('Enter', t)).toEqual({ kind: 'none' }); // Entrée laissée au champ
  });

  it('Entrée avec rafale trop courte (<4) → none (pas un scan)', () => {
    expect(scan(new WedgeDecoder(), 'AB', 4).final).toEqual({ kind: 'none' });
  });

  it('deux scans rapides successifs → deux codes distincts', () => {
    const d = new WedgeDecoder();
    expect(scan(d, '1111111111116', 5, 1000).final).toMatchObject({ kind: 'scan', code: '1111111111116' });
    expect(scan(d, '2222222222227', 5, 2000).final).toMatchObject({ kind: 'scan', code: '2222222222227' });
  });

  it('champ actif (scénario 5) : les caractères de la rafale sont « swallow » → non écrits', () => {
    // L'appelant (capture phase) fait preventDefault sur chaque `swallow` → le code
    // n'est PAS injecté dans le champ. Seul le 1er caractère est passthrough.
    const { actions, final } = scan(new WedgeDecoder(), '3760012345678', 5);
    const swallowed = actions.filter((a) => a === 'swallow').length;
    expect(swallowed).toBe(12); // 13 - 1 (le 1er passthrough)
    expect(final.kind).toBe('scan');
  });

  it('barcodeFormat', () => {
    expect(barcodeFormat('12345678')).toBe('EAN-8');
    expect(barcodeFormat('1234567890123')).toBe('EAN-13');
    expect(barcodeFormat('XYZ')).toBe('CODE-128');
  });

  it('suffixe TAB (douchette configurée en Tab) → scan, jamais un silence', () => {
    const d = new WedgeDecoder();
    let t = 1000;
    for (const ch of '3760012345678') {
      d.feed(ch, t);
      t += 5;
    }
    expect(d.feed('Tab', t)).toEqual({ kind: 'scan', code: '3760012345678', format: 'EAN-13' });
  });

  it('Tab humain (navigation, aucune rafale) → none, jamais intercepté', () => {
    const d = new WedgeDecoder();
    expect(d.feed('Tab', 1000)).toEqual({ kind: 'none' });
  });

  it('suffixe retour chariot \\r → scan', () => {
    const d = new WedgeDecoder();
    let t = 1000;
    for (const ch of '20123452') {
      d.feed(ch, t);
      t += 4;
    }
    expect(d.feed('\r', t)).toMatchObject({ kind: 'scan', code: '20123452' });
  });

  it('flushPending : douchette SANS suffixe → la rafale est close par silence', () => {
    const d = new WedgeDecoder();
    let t = 1000;
    for (const ch of 'WESP12345') {
      d.feed(ch, t);
      t += 5;
    }
    // Trop tôt (dernière touche récente) → rien.
    expect(d.flushPending(t)).toBeNull();
    // Silence dépassé → scan émis, buffer vidé.
    expect(d.flushPending(t + 120)).toEqual({ code: 'WESP12345', format: 'CODE-128' });
    expect(d.flushPending(t + 500)).toBeNull(); // une seule émission
  });

  it('flushPending : frappe humaine (pas de rafale) → jamais de faux scan', () => {
    const d = new WedgeDecoder();
    d.feed('a', 1000);
    d.feed('b', 1400); // lent → humain
    expect(d.flushPending(2000)).toBeNull();
  });
});

describe('isEditableTarget', () => {
  it('INPUT / TEXTAREA / SELECT / contentEditable → éditable', () => {
    expect(isEditableTarget({ tagName: 'INPUT' })).toBe(true);
    expect(isEditableTarget({ tagName: 'TEXTAREA' })).toBe(true);
    expect(isEditableTarget({ tagName: 'SELECT' })).toBe(true);
    expect(isEditableTarget({ tagName: 'DIV', isContentEditable: true })).toBe(true);
  });

  it('éléments non éditables / null → non éditable', () => {
    expect(isEditableTarget({ tagName: 'DIV' })).toBe(false);
    expect(isEditableTarget(null)).toBe(false);
  });
});
