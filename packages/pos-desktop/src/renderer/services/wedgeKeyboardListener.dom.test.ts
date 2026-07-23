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
  it('scan rapide, champ focalisé : reconnu, et AUCUN caractère ne reste dans le champ', () => {
    const enter = type('3760012345678', 5); // 5 ms/car = douchette
    expect(onBarcode).toHaveBeenCalledTimes(1);
    expect(onBarcode.mock.calls[0][0]).toMatchObject({ code: '3760012345678', format: 'EAN-13' });
    expect(input.value).toBe(''); // le 1er caractère a été inséré puis RETIRÉ
    // Seul le 1er caractère a atteint le champ ; les 12 suivants ont été avalés.
    expect(reachedField).toBe(1);
    // L'Entrée du scan est neutralisée (pas de submit / action parasite).
    expect(enter.defaultPrevented).toBe(true);
    // Seul le 1er caractère (passthrough) remonte ; les 12 avalés ET l'Entrée du scan
    // NE remontent PAS (stopPropagation) → aucune action parasite, aucun submit.
    const bubbledKeys = bubbleSpy.mock.calls.map((c) => (c[0] as KeyboardEvent).key);
    expect(bubbledKeys).toEqual(['3']); // uniquement le 1er caractère de "3760…"
    expect(bubbledKeys).not.toContain('Enter');
    expect(submitSpy).not.toHaveBeenCalled();
  });

  it('frappe humaine lente : le champ reçoit le texte, aucun scan', () => {
    const enter = type('12345', 250); // 250 ms/car = humain
    expect(onBarcode).not.toHaveBeenCalled();
    expect(input.value).toBe('12345');
    expect(reachedField).toBe(5); // toutes les frappes ont atteint le champ
    expect(enter.defaultPrevented).toBe(false); // Entrée humaine non neutralisée
    expect(bubbleSpy).toHaveBeenCalled(); // la frappe humaine remonte normalement
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
});
