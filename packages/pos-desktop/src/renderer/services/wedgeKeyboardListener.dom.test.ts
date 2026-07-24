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
