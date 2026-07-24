// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { attachWedgeKeyboardListener } from './wedgeKeyboardListener';

/**
 * RÉGRESSION (exigée owner) — INTÉGRITÉ STRICTE du champ actif pendant un scan.
 *
 * L'ancien design laissait passer le 1er caractère (passthrough) PUIS le retirait.
 * Défaut : si une sélection existe, ce 1er caractère la REMPLACE, et le retrait
 * (suppression d'un caractère) ne restaure PAS le texte sélectionné → corruption.
 *
 * Contrat prouvé ici : quel que soit l'état du champ (curseur début/milieu/fin,
 * sélection partielle, sélection totale, autre champ), un scan :
 *   - est reconnu et routé (onBarcode appelé) ;
 *   - laisse `value`, `selectionStart`, `selectionEnd` STRICTEMENT inchangés.
 * Aucun caractère du scan ne doit avoir été inséré, même transitoirement de façon
 * observable par le champ.
 *
 * Le timing est piloté par les faux timers de Vitest : Date.now() ET setTimeout
 * sont contrôlés, donc une rafale (≤ maxInterKeyMs entre touches) est déterministe.
 */

let input: HTMLInputElement;
let other: HTMLInputElement;
let onBarcode: ReturnType<typeof vi.fn>;
let detach: () => void;

/** Modélise l'insertion navigateur : insère le caractère si non empêché/stoppé. */
function mimicInsertion(this: HTMLInputElement, e: KeyboardEvent) {
  if (e.key.length === 1 && !e.defaultPrevented) {
    const el = e.currentTarget as HTMLInputElement;
    const s = el.selectionStart ?? el.value.length;
    const eIdx = el.selectionEnd ?? el.value.length;
    el.setRangeText(e.key, s, eIdx, 'end');
  }
}

/** Rafale douchette : caractères espacés de 5 ms (≤ maxInterKeyMs) + Entrée. */
function scanInto(el: HTMLInputElement, str: string) {
  for (const ch of str) {
    vi.advanceTimersByTime(5);
    el.dispatchEvent(new KeyboardEvent('keydown', { key: ch, bubbles: true, cancelable: true }));
  }
  vi.advanceTimersByTime(5);
  el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
}

beforeEach(() => {
  vi.useFakeTimers();
  document.body.replaceChildren();
  input = document.createElement('input');
  other = document.createElement('input');
  document.body.append(input, other);
  input.addEventListener('keydown', mimicInsertion);
  other.addEventListener('keydown', mimicInsertion);
  onBarcode = vi.fn();
  detach = attachWedgeKeyboardListener(document, (b) => onBarcode(b.code));
});

afterEach(() => {
  detach();
  vi.useRealTimers();
});

/** Vérifie value + sélection strictement identiques avant/après le scan. */
function expectFieldUntouched(el: HTMLInputElement, value: string, selStart: number, selEnd: number) {
  expect(el.value).toBe(value);
  expect(el.selectionStart).toBe(selStart);
  expect(el.selectionEnd).toBe(selEnd);
}

describe('Douchette — intégrité stricte du champ actif pendant un scan', () => {
  const EAN = '3760012345678';

  it('curseur au DÉBUT du texte existant : scan reconnu, champ intact', () => {
    input.value = 'lait bio';
    input.focus();
    input.setSelectionRange(0, 0);
    scanInto(input, EAN);
    expect(onBarcode).toHaveBeenCalledWith(EAN);
    expectFieldUntouched(input, 'lait bio', 0, 0);
  });

  it('curseur au MILIEU : scan reconnu, champ intact', () => {
    input.value = 'lait bio';
    input.focus();
    input.setSelectionRange(4, 4);
    scanInto(input, EAN);
    expect(onBarcode).toHaveBeenCalledWith(EAN);
    expectFieldUntouched(input, 'lait bio', 4, 4);
  });

  it('curseur à la FIN : scan reconnu, champ intact', () => {
    input.value = 'lait bio';
    input.focus();
    input.setSelectionRange(8, 8);
    scanInto(input, EAN);
    expect(onBarcode).toHaveBeenCalledWith(EAN);
    expectFieldUntouched(input, 'lait bio', 8, 8);
  });

  it('SÉLECTION PARTIELLE : le scan ne remplace PAS la sélection (bug historique)', () => {
    input.value = 'lait bio';
    input.focus();
    input.setSelectionRange(0, 4); // « lait » sélectionné
    scanInto(input, EAN);
    expect(onBarcode).toHaveBeenCalledWith(EAN);
    expectFieldUntouched(input, 'lait bio', 0, 4);
  });

  it('SÉLECTION TOTALE : le scan ne remplace PAS tout le texte (bug historique)', () => {
    input.value = 'lait bio';
    input.focus();
    input.setSelectionRange(0, 8); // tout sélectionné
    scanInto(input, EAN);
    expect(onBarcode).toHaveBeenCalledWith(EAN);
    expectFieldUntouched(input, 'lait bio', 0, 8);
  });

  it('AUTRE champ actif (sélection totale) : champ intact, scan quand même routé', () => {
    other.value = 'référence-XYZ';
    other.focus();
    other.setSelectionRange(0, 13);
    scanInto(other, EAN);
    expect(onBarcode).toHaveBeenCalledWith(EAN);
    expectFieldUntouched(other, 'référence-XYZ', 0, 13);
  });

  it('deux scans successifs du même produit, champ avec sélection : deux signaux, champ intact', () => {
    input.value = 'lait bio';
    input.focus();
    input.setSelectionRange(0, 8);
    scanInto(input, EAN);
    vi.advanceTimersByTime(400); // re-présentation volontaire
    scanInto(input, EAN);
    expect(onBarcode).toHaveBeenCalledTimes(2);
    expectFieldUntouched(input, 'lait bio', 0, 8);
  });
});
