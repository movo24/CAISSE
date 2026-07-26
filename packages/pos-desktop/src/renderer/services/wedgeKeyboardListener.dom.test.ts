// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { attachWedgeKeyboardListener } from './wedgeKeyboardListener';

/**
 * Test DOM RÉALISTE de la douchette clavier-wedge : un vrai champ focalisé, de vrais
 * KeyboardEvent reproduisant la séquence de la Lenvii E655, et la modélisation de
 * l'insertion navigateur (un keydown imprimable insère le caractère SAUF si
 * preventDefault a été appelé ou si la propagation a été stoppée en capture).
 *
 * Prouve ce que le test du prédicat ne prouvait pas :
 *  - un scan est reconnu même quand un champ a le focus ;
 *  - AUCUN caractère du code ne reste dans le champ (le 1er, seul à passer, est retiré) ;
 *  - la frappe humaine reste parfaitement fonctionnelle ;
 *  - le produit est signalé UNE seule fois ; deux vrais scans → deux signaux ;
 *  - l'Entrée d'un scan est neutralisée (defaultPrevented + propagation stoppée) → ni
 *    submit, ni action parasite.
 */

let clock = 0;
const now = () => clock;

let input: HTMLInputElement;
let form: HTMLFormElement;
let detach: () => void;
let onBarcode: ReturnType<typeof vi.fn>;
let reachedField: number; // nb de keydown imprimables ayant atteint le champ (non avalés)
let bubbleSpy: ReturnType<typeof vi.fn>; // gestionnaire global bubble (action parasite)
let submitSpy: ReturnType<typeof vi.fn>;

/** Modélise l'insertion navigateur : insère le caractère si non empêché / non stoppé. */
function mimicInsertion(e: KeyboardEvent) {
  if (e.key.length === 1 && !e.defaultPrevented) {
    reachedField += 1;
    const s = input.selectionStart ?? input.value.length;
    input.setRangeText(e.key, s, s, 'end');
  }
}

function press(key: string): KeyboardEvent {
  const ev = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
  input.dispatchEvent(ev);
  return ev;
}

/** Tape une chaîne caractère par caractère avec un écart donné, puis renvoie l'event Entrée. */
function type(str: string, gapMs: number): KeyboardEvent {
  for (const ch of str) {
    clock += gapMs;
    press(ch);
  }
  clock += gapMs;
  return press('Enter');
}

beforeEach(() => {
  clock = 1000;
  reachedField = 0;
  document.body.replaceChildren();
  form = document.createElement('form');
  input = document.createElement('input');
  form.appendChild(input);
  document.body.appendChild(form);
  input.addEventListener('keydown', mimicInsertion); // insertion navigateur modélisée
  submitSpy = vi.fn((e: Event) => e.preventDefault());
  form.addEventListener('submit', submitSpy);
  bubbleSpy = vi.fn();
  document.addEventListener('keydown', bubbleSpy); // gestionnaire global bubble = action parasite
  onBarcode = vi.fn();
  detach = attachWedgeKeyboardListener(document, onBarcode, { now });
  input.focus();
});

afterEach(() => {
  detach();
  document.removeEventListener('keydown', bubbleSpy);
});

describe('Douchette clavier-wedge — comportement DOM réel (champ focalisé)', () => {
  it('scan rapide, champ focalisé : reconnu, et AUCUN caractère n’atteint JAMAIS le champ', () => {
    const enter = type('3760012345678', 5); // 5 ms/car = douchette
    expect(onBarcode).toHaveBeenCalledTimes(1);
    expect(onBarcode.mock.calls[0][0]).toMatchObject({ code: '3760012345678', format: 'EAN-13' });
    expect(input.value).toBe(''); // buffer-avant-insertion : rien n'a jamais été écrit
    // Modèle buffer-avant-insertion : AUCUN caractère du scan n'atteint le champ.
    expect(reachedField).toBe(0);
    // L'Entrée du scan est neutralisée (pas de submit / action parasite).
    expect(enter.defaultPrevented).toBe(true);
    // Aucun caractère du scan ni l'Entrée ne remontent (preventDefault + stopPropagation
    // en capture) → aucune action parasite, aucun submit.
    const bubbledKeys = bubbleSpy.mock.calls.map((c) => (c[0] as KeyboardEvent).key);
    expect(bubbledKeys).toEqual([]);
    expect(submitSpy).not.toHaveBeenCalled();
  });

  it('frappe humaine lente : le champ reçoit le texte (restitué), aucun scan', () => {
    const enter = type('12345', 250); // 250 ms/car = humain
    expect(onBarcode).not.toHaveBeenCalled();
    // Chaque caractère est avalé puis RESTITUÉ (setRangeText) quand le rythme lent
    // révèle une frappe humaine → le champ contient bien le texte tapé.
    expect(input.value).toBe('12345');
    expect(enter.defaultPrevented).toBe(false); // Entrée humaine non neutralisée
    expect(bubbleSpy).toHaveBeenCalled(); // l'Entrée humaine remonte normalement
  });

  it('contenu préexistant du champ préservé après un scan', () => {
    input.value = 'AB';
    input.setSelectionRange(2, 2);
    type('3760012345678', 5);
    expect(onBarcode).toHaveBeenCalledTimes(1);
    expect(input.value).toBe('AB'); // le caractère du scan a été retiré, 'AB' intact
  });

  it('deux vrais scans successifs (≥300 ms) → deux signaux (→ quantité 2 côté panier)', () => {
    type('3760012345678', 5); // scan 1
    clock += 400; // re-présentation volontaire de l'article
    type('3760012345678', 5); // scan 2 (même article)
    expect(onBarcode).toHaveBeenCalledTimes(2);
    expect(input.value).toBe(''); // toujours rien dans le champ
  });

  it('les raccourcis clavier (Ctrl+A) ne sont pas interceptés', () => {
    clock += 5;
    const ev = new KeyboardEvent('keydown', { key: 'a', ctrlKey: true, bubbles: true, cancelable: true });
    input.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(false); // laissé passer
    expect(onBarcode).not.toHaveBeenCalled();
  });

  it('suffixe TAB : scan reconnu, Tab neutralisé (pas de changement de focus parasite)', () => {
    for (const ch of '3760012345678') {
      clock += 5;
      press(ch);
    }
    clock += 5;
    const tab = press('Tab');
    expect(onBarcode).toHaveBeenCalledTimes(1);
    expect(onBarcode.mock.calls[0][0]).toMatchObject({ code: '3760012345678', format: 'EAN-13' });
    expect(tab.defaultPrevented).toBe(true); // le Tab du scan n'altère pas le focus
    expect(input.value).toBe(''); // aucun caractère ne reste dans le champ
  });

  it('douchette SANS suffixe : la rafale est close par silence (timer) → scan émis', () => {
    vi.useFakeTimers();
    try {
      for (const ch of 'WESP12345') {
        clock += 5;
        press(ch);
      }
      expect(onBarcode).not.toHaveBeenCalled(); // rien tant que le silence n'est pas constaté
      clock += 500; // l'horloge du décodeur avance au-delà de maxInterKeyMs
      vi.advanceTimersByTime(200); // le timer DOM (120 ms) expire
      expect(onBarcode).toHaveBeenCalledTimes(1);
      expect(onBarcode.mock.calls[0][0]).toMatchObject({ code: 'WESP12345' });
      expect(input.value).toBe(''); // buffer-avant-insertion : rien n'a jamais été écrit
      vi.advanceTimersByTime(1000); // une seule émission, jamais de rejeu
      expect(onBarcode).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

/**
 * P0 terrain 2026-07-24 (CHARBON BLACK COCO, E655) : sur l'écran de vente, AUCUN
 * champ n'a le focus. Le scan doit fonctionner SANS clic préalable, MÊME si la
 * douchette envoie plus lentement que le seuil de rafale (le mode « aucun champ
 * = scanner certain » n'applique aucun seuil de vitesse).
 */
describe('Douchette — mode « aucun champ focalisé = scanner certain »', () => {
  /** Tape sur le DOCUMENT (aucun champ focalisé) avec un écart donné, puis Entrée. */
  function typeNoField(str: string, gapMs: number, terminator: string | null = 'Enter'): KeyboardEvent | null {
    input.blur();                 // aucun champ éditable focalisé
    document.body.focus?.();
    let last: KeyboardEvent | null = null;
    for (const ch of str) {
      clock += gapMs;
      last = new KeyboardEvent('keydown', { key: ch, bubbles: true, cancelable: true });
      document.body.dispatchEvent(last);
    }
    if (terminator) {
      clock += gapMs;
      last = new KeyboardEvent('keydown', { key: terminator, bubbles: true, cancelable: true });
      document.body.dispatchEvent(last);
    }
    return last;
  }

  it('scan LENT (200 ms/car, > seuil) sans focus → reconnu (le bug « marche seulement avec focus »)', () => {
    typeNoField('4260421350771', 200); // E655 lente, bien au-delà de maxInterKeyMs
    expect(onBarcode).toHaveBeenCalledTimes(1);
    expect(onBarcode.mock.calls[0][0]).toMatchObject({ code: '4260421350771', format: 'EAN-13' });
  });

  it('sans focus, aucun caractère n\'est laissé dans un champ (rien n\'est focalisé)', () => {
    typeNoField('4260421350771', 150);
    expect(input.value).toBe('');
    expect(onBarcode).toHaveBeenCalledTimes(1);
  });

  it('deux scans successifs du même code sans focus → deux émissions (→ quantité +1 côté panier)', () => {
    typeNoField('4260421350771', 120);
    clock += 500;
    typeNoField('4260421350771', 120);
    expect(onBarcode).toHaveBeenCalledTimes(2);
  });

  it('suffixe Tab sans focus → reconnu', () => {
    typeNoField('4260421350771', 180, 'Tab');
    expect(onBarcode.mock.calls[0][0]).toMatchObject({ code: '4260421350771' });
  });

  it('sans suffixe (silence) sans focus → émis après le flush « aucun champ »', () => {
    vi.useFakeTimers();
    try {
      typeNoField('4260421350771', 100, null); // pas de terminateur
      expect(onBarcode).not.toHaveBeenCalled();
      clock += 1000;
      vi.advanceTimersByTime(400); // > noFieldFlushMs (300)
      expect(onBarcode).toHaveBeenCalledTimes(1);
      expect(onBarcode.mock.calls[0][0]).toMatchObject({ code: '4260421350771' });
    } finally {
      vi.useRealTimers();
    }
  });
});

/**
 * P0 terrain 2026-07-25 — CAUSE RACINE mesurée sur la caisse Windows avec la vraie
 * Lenvii E655 (enregistrement bas niveau des keydown, code CHARBON 4260421350771) :
 *
 *   Shift · 4 2 6 0 4 2 1 3 5 0 7 · **Shift** · 7 1 · Enter
 *
 * La douchette maintient Shift enfoncé (`shiftKey: true` sur CHAQUE chiffre) et
 * RÉÉMET un keydown « Shift » au milieu de la rafale. Ce Shift intermédiaire vidait
 * le buffer ([WEDGE-TIMING] pos:10 → pos:1) : à l'Entrée il ne restait que « 71 »,
 * sous minLength → aucun scan émis. Aucun test n'émettait de modificateur, d'où
 * trois correctifs verts en CI et toujours cassés sur la caisse.
 */
/**
 * Relevés BRUTS de la sonde passive posée sur la caisse Windows (scanner Lenvii
 * E655 réel, application v1.8.3 officielle non modifiée, code CHARBON BLACK COCO
 * 4260421350771). Couples [touche, écart réel en ms] tels qu'enregistrés.
 * Noter le `Shift` réémis en 13ᵉ position, au milieu du code.
 */
const RELEVE_HORS_FOCUS: ReadonlyArray<readonly [string, number]> = [
  ['Shift', 0], ['4', 5], ['2', 1], ['6', 4], ['0', 3], ['4', 7], ['2', 5], ['1', 3],
  ['3', 3], ['5', 17], ['0', 3], ['7', 5], ['Shift', 8], ['7', 2], ['1', 3], ['Enter', 10],
];

const RELEVE_DANS_RECHERCHE: ReadonlyArray<readonly [string, number]> = [
  ['Shift', 0], ['4', 13], ['2', 18], ['6', 7], ['0', 8], ['4', 8], ['2', 6], ['1', 6],
  ['3', 7], ['5', 6], ['0', 6], ['7', 6], ['Shift', 5], ['7', 25], ['1', 4], ['Enter', 13],
];

describe('Douchette — modificateurs émis PENDANT la rafale (séquence réelle E655)', () => {
  /** Rejoue la séquence exacte du matériel : Shift initial, shiftKey sur chaque
   *  caractère, et un Shift réémis avant l'index `midShiftAt`. */
  function typeLikeE655(
    str: string,
    gapMs: number,
    opts: { focused: boolean; midShiftAt?: number | null; terminator?: string | null } = { focused: false },
  ): void {
    const { focused, midShiftAt = str.length - 2, terminator = 'Enter' } = opts;
    const target: HTMLElement = focused ? input : document.body;
    if (focused) input.focus();
    else { input.blur(); document.body.focus?.(); }

    const fire = (key: string, shiftKey: boolean) => {
      target.dispatchEvent(new KeyboardEvent('keydown', { key, shiftKey, bubbles: true, cancelable: true }));
    };

    clock += gapMs;
    fire('Shift', true); // Shift maintenu dès le début de la rafale
    for (let i = 0; i < str.length; i++) {
      if (midShiftAt !== null && i === midShiftAt) {
        clock += gapMs;
        fire('Shift', true); // ⚠️ réémission en PLEIN scan — ce qui cassait tout
      }
      clock += gapMs;
      fire(str[i], true);
    }
    if (terminator) {
      clock += gapMs;
      fire(terminator, false);
    }
  }

  it('RÉGRESSION P0 : Shift réémis en pleine rafale, sans focus → scan complet émis', () => {
    typeLikeE655('4260421350771', 5, { focused: false });
    expect(onBarcode).toHaveBeenCalledTimes(1);
    // Le code doit être ENTIER : c'est précisément ce qui était tronqué à « 71 ».
    expect(onBarcode.mock.calls[0][0]).toMatchObject({ code: '4260421350771', format: 'EAN-13' });
  });

  it('douchette LENTE + Shift en pleine rafale, sans focus → scan complet émis', () => {
    typeLikeE655('4260421350771', 200, { focused: false }); // bien au-delà du seuil de rafale
    expect(onBarcode).toHaveBeenCalledTimes(1);
    expect(onBarcode.mock.calls[0][0]).toMatchObject({ code: '4260421350771' });
  });

  it('Shift en pleine rafale, CHAMP focalisé → scan émis et champ jamais pollué', () => {
    input.value = 'texte existant';
    input.setSelectionRange(14, 14);
    typeLikeE655('4260421350771', 5, { focused: true });
    expect(onBarcode).toHaveBeenCalledTimes(1);
    expect(onBarcode.mock.calls[0][0]).toMatchObject({ code: '4260421350771' });
    expect(input.value).toBe('texte existant'); // aucun caractère du scan inséré
    expect(reachedField).toBe(0);
  });

  it('plusieurs Shift réémis dans la même rafale → un seul scan, code intact', () => {
    input.blur();
    document.body.focus?.();
    const fire = (key: string, shiftKey: boolean) => {
      clock += 5;
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key, shiftKey, bubbles: true, cancelable: true }));
    };
    fire('Shift', true);
    const code = '4260421350771';
    for (let i = 0; i < code.length; i++) {
      if (i % 4 === 0) fire('Shift', true); // Shift toutes les 4 touches
      fire(code[i], true);
    }
    fire('Enter', false);
    expect(onBarcode).toHaveBeenCalledTimes(1);
    expect(onBarcode.mock.calls[0][0]).toMatchObject({ code: '4260421350771' });
  });

  it('les verrous (CapsLock/NumLock) en pleine rafale ne rompent pas le scan', () => {
    input.blur();
    document.body.focus?.();
    const fire = (key: string) => {
      clock += 5;
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
    };
    for (const ch of '42604') fire(ch);
    fire('CapsLock');
    fire('NumLock');
    for (const ch of '21350771') fire(ch);
    fire('Enter');
    expect(onBarcode).toHaveBeenCalledTimes(1);
    expect(onBarcode.mock.calls[0][0]).toMatchObject({ code: '4260421350771' });
  });

  it('un Shift SEUL (aucune rafale en cours) reste sans effet', () => {
    input.blur();
    document.body.focus?.();
    clock += 5;
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Shift', shiftKey: true, bubbles: true, cancelable: true }));
    expect(onBarcode).not.toHaveBeenCalled();
  });

  it('séquence PHYSIQUE capturée le 2026-07-26 — hors focus → scan complet, une seule fois', () => {
    // Relevé brut de la sonde passive sur la caisse (scanner réel, v1.8.3 intacte,
    // `activeElement = BODY`). Couples [touche, écart réel en ms].
    input.blur();
    document.body.focus?.();
    for (const [key, gap] of RELEVE_HORS_FOCUS) {
      clock += gap;
      document.body.dispatchEvent(
        new KeyboardEvent('keydown', { key, shiftKey: key !== 'Enter', bubbles: true, cancelable: true }),
      );
    }
    expect(onBarcode).toHaveBeenCalledTimes(1);
    expect(onBarcode.mock.calls[0][0]).toMatchObject({ code: '4260421350771', format: 'EAN-13' });
  });

  it('séquence PHYSIQUE capturée le 2026-07-26 — champ focalisé → scan émis, champ NON pollué', () => {
    // Même relevé, mais curseur dans « Recherche produit ». Avant correctif, le
    // Shift médian déversait « 42604213507 » dans le champ (trace CHAMP à
    // 01:10:26.651) et aucun scan n'était émis : le produit n'arrivait au panier
    // que par le gestionnaire Entrée du champ de recherche. Désormais le chemin
    // douchette émet un vrai scan et le champ reste intact.
    input.focus();
    for (const [key, gap] of RELEVE_DANS_RECHERCHE) {
      clock += gap;
      input.dispatchEvent(
        new KeyboardEvent('keydown', { key, shiftKey: key !== 'Enter', bubbles: true, cancelable: true }),
      );
    }
    expect(onBarcode).toHaveBeenCalledTimes(1);
    expect(onBarcode.mock.calls[0][0]).toMatchObject({ code: '4260421350771' });
    expect(input.value).toBe(''); // aucun caractère déversé dans la recherche
    expect(reachedField).toBe(0);
  });

  it('trois scans physiques successifs hors focus → exactement trois émissions', () => {
    for (let n = 0; n < 3; n++) {
      input.blur();
      document.body.focus?.();
      for (const [key, gap] of RELEVE_HORS_FOCUS) {
        clock += gap;
        document.body.dispatchEvent(
          new KeyboardEvent('keydown', { key, shiftKey: key !== 'Enter', bubbles: true, cancelable: true }),
        );
      }
      clock += 600; // re-présentation de l'article
    }
    expect(onBarcode).toHaveBeenCalledTimes(3);
    for (const call of onBarcode.mock.calls) expect(call[0].code).toBe('4260421350771');
  });

  it('la frappe humaine avec Shift (majuscules) reste intacte dans le champ', () => {
    input.focus();
    const fire = (key: string, shiftKey: boolean) => {
      clock += 250; // rythme humain
      input.dispatchEvent(new KeyboardEvent('keydown', { key, shiftKey, bubbles: true, cancelable: true }));
    };
    fire('Shift', true);
    fire('A', true);
    fire('Shift', true);
    fire('B', true);
    fire('Enter', false); // l'Entrée humaine restitue le caractère encore bufferisé
    expect(onBarcode).not.toHaveBeenCalled();
    expect(input.value).toBe('AB'); // restitution normale, Shift sans effet parasite
  });
});
